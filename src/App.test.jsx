/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.jsx";

function mockFetch(responseFactory) {
  const fetchMock = vi.fn(responseFactory);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function okJson(body) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body)
  });
}

function okBlob(blob) {
  return Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(blob)
  });
}

function failJson(status, body) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body)
  });
}

function extractDatePart(value) {
  const text = String(value ?? "");
  return text.includes("T") ? text.slice(0, 10) : "";
}

function extractTimePart(value) {
  const text = String(value ?? "");
  return text.includes("T") ? text.slice(11, 16) : text;
}

function setDateTimeValue(target, value) {
  const input = target.startsWith("testid:")
    ? screen.getByTestId(target.slice("testid:".length))
    : screen.getAllByLabelText(target)[0];
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  valueSetter.call(input, value);
  fireEvent.input(input, { target: { value } });
  fireEvent.change(input, { target: { value } });
}

function mockUserManagementFetch(
  initialUsers,
  initialVehicles = [],
  loginUser = { username: "admin", role: "admin" }
) {
  let users = [...initialUsers];
  let vehicles = [...initialVehicles];

  return mockFetch((url, options = {}) => {
    const method = options.method ?? "GET";

    if (url === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (url === "/api/users" && method === "GET") {
      return okJson({ users });
    }

    if (url === "/api/vehicles" && method === "GET") {
      return okJson({ vehicles });
    }

    if (url === "/api/users" && method === "POST") {
      const body = JSON.parse(options.body);
      if (users.some((existingUser) => existingUser.username === body.username)) {
        return failJson(409, { message: "账号已存在" });
      }
      const createdUser = {
        id: `id-${body.username}`,
        username: body.username,
        role: body.role,
        isBuiltinAdmin: false
      };
      users = [...users, createdUser];
      return okJson({ user: createdUser });
    }

    if (url.startsWith("/api/users/") && url.endsWith("/reset-password")) {
      const id = url.split("/").at(-2);
      const target = users.find((user) => user.id === id);

      if (
        target?.role === "admin" &&
        loginUser.username !== "admin"
      ) {
        return failJson(400, { message: "只能重置普通用户密码" });
      }

      return okJson({ message: "密码已重置" });
    }

    if (url.startsWith("/api/users/") && method === "DELETE") {
      const id = url.split("/").at(-1);
      const deletingUser = users.find((existingUser) => existingUser.id === id);

      if (deletingUser?.username === loginUser.username && loginUser.username !== "admin") {
        return failJson(400, { message: "不能删除当前登录管理员账号" });
      }

      users = users.filter((existingUser) => existingUser.id !== id);
      return Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve({})
      });
    }

    if (url === "/api/vehicles" && method === "POST") {
      const body = JSON.parse(options.body);
      if (vehicles.some((existingVehicle) => existingVehicle.vehicleCode === body.vehicleCode)) {
        return failJson(409, { message: "车辆编号已存在" });
      }
      if (vehicles.some((existingVehicle) => existingVehicle.plateNumber === body.plateNumber)) {
        return failJson(409, { message: "车牌号已存在" });
      }
      const createdVehicle = {
        id: `id-${body.vehicleCode}`,
        vehicleCode: body.vehicleCode,
        plateNumber: body.plateNumber,
        brandModel: body.brandModel,
        isDeleted: false
      };
      vehicles = [...vehicles, createdVehicle];
      return okJson({ vehicle: createdVehicle });
    }

    if (url.startsWith("/api/vehicles/") && method === "DELETE") {
      const id = url.split("/").at(-1);
      vehicles = vehicles.filter((existingVehicle) => existingVehicle.id !== id);
      return Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve({})
      });
    }

    return failJson(404, { message: "not found" });
  });
}

function mockRegistryFetch({
  loginUser = { username: "employee", role: "employee" },
  vehicles = [],
  latestMileageByVehicleId = {},
  submitErrorMessage = ""
} = {}) {
  let mileageByVehicleId = { ...latestMileageByVehicleId };
  const records = [];

  const fetchMock = mockFetch((url, options = {}) => {
    const method = options.method ?? "GET";

    if (url === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (url === "/api/vehicles" && method === "GET") {
      return okJson({
        vehicles: vehicles.filter((vehicle) => !vehicle.isDeleted)
      });
    }

    if (url.startsWith("/api/vehicles/") && url.endsWith("/latest-mileage") && method === "GET") {
      const parts = url.split("/");
      const vehicleId = parts.at(-2);
      const vehicle = vehicles.find((item) => item.id === vehicleId && !item.isDeleted);

      if (!vehicle) {
        return failJson(404, { message: "车辆不存在或已失效" });
      }

      return okJson({
        startMileage: Object.hasOwn(mileageByVehicleId, vehicleId) ? mileageByVehicleId[vehicleId] : null
      });
    }

    if (url === "/api/records" && method === "POST") {
      if (submitErrorMessage) {
        return failJson(400, { message: submitErrorMessage });
      }

      const body = JSON.parse(options.body);
      const vehicle = vehicles.find((item) => item.id === body.vehicleId && !item.isDeleted);

      if (!vehicle) {
        return failJson(400, { message: "车辆不存在或已失效" });
      }

      const startMileage = Number(body.startMileage);
      const endMileage = Number(body.endMileage);
      const distance = endMileage - startMileage;
      const departureTime = extractTimePart(body.departureTime);
      const returnTime = extractTimePart(body.returnTime);

      if (Number.isNaN(startMileage) || Number.isNaN(endMileage) || startMileage < 0 || endMileage < 0) {
        return failJson(400, { message: "起步公里和终点公里必须为非负数字" });
      }

      if (endMileage < startMileage) {
        return failJson(400, { message: "终点公里不能小于起步公里" });
      }

      mileageByVehicleId = {
        ...mileageByVehicleId,
        [body.vehicleId]: endMileage
      };
      records.push({
        ...body,
        departureTime,
        returnTime,
        distance
      });

      return Promise.resolve({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            message: "登记已提交",
            record: {
              id: `record-${records.length}`,
              vehicleId: body.vehicleId,
              distance,
              isCrossDay:
                (extractDatePart(body.returnTime) || body.returnDate) !==
                  (extractDatePart(body.departureTime) || body.departureDate) ||
                returnTime < departureTime
            }
          })
      });
    }

    return failJson(404, { message: "not found" });
  });

  return {
    fetchMock,
    getRecords() {
      return [...records];
    }
  };
}

function mockAdminRecordManagementFetch({
  loginUser = { username: "admin", role: "admin" },
  users = [],
  vehicles = [],
  records = [],
  latestMileageByVehicleId = {},
  exportBlob = new Blob(["fake"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })
} = {}) {
  let nextUsers = [...users];
  let nextVehicles = [...vehicles];
  let nextRecords = [...records];
  let mileageByVehicleId = { ...latestMileageByVehicleId };

  return mockFetch((url, options = {}) => {
    const method = options.method ?? "GET";

    if (url === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (url === "/api/users" && method === "GET") {
      return okJson({ users: nextUsers });
    }

    if (url === "/api/vehicles" && method === "GET") {
      return okJson({ vehicles: nextVehicles.filter((vehicle) => !vehicle.isDeleted) });
    }

    if (url.startsWith("/api/vehicles/") && url.endsWith("/latest-mileage") && method === "GET") {
      const vehicleId = url.split("/").at(-2);
      return okJson({
        startMileage: Object.hasOwn(mileageByVehicleId, vehicleId) ? mileageByVehicleId[vehicleId] : null
      });
    }

    if (url === "/api/records" && method === "GET") {
      return okJson({
        records: nextRecords
      });
    }

    if (url === "/api/records/export" && method === "GET") {
      return okBlob(exportBlob);
    }

    if (url.startsWith("/api/records/") && method === "DELETE") {
      const id = url.split("/").at(-1);
      const deletedRecord = nextRecords.find((record) => record.id === id);
      nextRecords = nextRecords.filter((record) => record.id !== id);
      if (deletedRecord) {
        const vehicleRecords = nextRecords
          .filter((record) => record.vehicleId === deletedRecord.vehicleId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        mileageByVehicleId[deletedRecord.vehicleId] = vehicleRecords.at(-1)?.endMileage ?? null;
      }
      return Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve({})
      });
    }

    return failJson(404, { message: "not found" });
  });
}

describe("Issue 1 authentication UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not submit login when username and password are blank", async () => {
    const fetchMock = mockFetch(() => okJson({}));
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("账号必填")).toBeInTheDocument();
    expect(screen.getByText("密码必填")).toBeInTheDocument();
  });

  it("shows the management entry after an administrator logs in", async () => {
    mockFetch(() => okJson({ user: { username: "admin", role: "admin" } }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("当前用户：admin")).toBeInTheDocument();
    expect(screen.getByText("当前角色：管理员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看全部" })).toBeInTheDocument();
  });

  it("does not show the management entry after an employee logs in", async () => {
    mockFetch(() => okJson({ user: { username: "employee", role: "employee" } }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "employee");
    await user.type(screen.getByLabelText("密码"), "Employee001");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("当前用户：employee")).toBeInTheDocument();
    expect(screen.getByText("当前角色：普通员工")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看全部" })).not.toBeInTheDocument();
  });

  it("validates mismatched new passwords before submitting a password change", async () => {
    const fetchMock = mockFetch(() => okJson({ user: { username: "employee", role: "employee" } }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "employee");
    await user.type(screen.getByLabelText("密码"), "Employee001");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "修改密码" }));
    await user.type(screen.getByLabelText("当前密码"), "Employee001");
    await user.type(screen.getByLabelText("新密码"), "NewEmployee001");
    await user.type(screen.getByLabelText("确认新密码"), "Different001");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(screen.getByText("两次新密码不一致")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns to the login page after a successful password change", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/login") {
        return okJson({ user: { username: "employee", role: "employee" } });
      }
      return okJson({ message: "密码已修改，请重新登录" });
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "employee");
    await user.type(screen.getByLabelText("密码"), "Employee001");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "修改密码" }));
    await user.type(screen.getByLabelText("当前密码"), "Employee001");
    await user.type(screen.getByLabelText("新密码"), "NewEmployee001");
    await user.type(screen.getByLabelText("确认新密码"), "NewEmployee001");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await screen.findByText("密码已修改，请重新登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});

describe("Issue 2 user management UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function loginAsAdminAndOpenUsers(user) {
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
  }

  async function loginAsManagerAndOpenUsers(user) {
    await user.type(screen.getByLabelText("账号"), "manager");
    await user.type(screen.getByLabelText("密码"), "Manager001");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
  }

  it("lets an administrator open user management and create an employee", async () => {
    mockUserManagementFetch([
      { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(user);
    await user.click(await screen.findByRole("button", { name: "新增用户" }));

    expect(screen.getByRole("heading", { name: "新增用户" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("新账号"), "new_employee");
    await user.type(screen.getByLabelText("初始密码"), "NewEmployee001");
    await user.selectOptions(screen.getByLabelText("角色"), "employee");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("new_employee")).toBeInTheDocument();
    expect(screen.getByText("普通员工")).toBeInTheDocument();
  });

  it("toggles the management area and inline forms in place", async () => {
    mockUserManagementFetch([
      { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
      { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const viewAllButton = await screen.findByRole("button", { name: "查看全部" });
    await user.click(viewAllButton);
    expect(await screen.findByRole("heading", { name: "用户账号管理" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增用户" }));
    expect(screen.getByRole("heading", { name: "新增用户" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增用户" }));
    expect(screen.queryByRole("heading", { name: "新增用户" })).not.toBeInTheDocument();

    await user.click(viewAllButton);
    expect(screen.queryByRole("heading", { name: "用户账号管理" })).not.toBeInTheDocument();
  });

  it("shows a duplicate username error without changing the visible list", async () => {
    mockUserManagementFetch([
      { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(user);
    await user.click(await screen.findByRole("button", { name: "新增用户" }));
    await user.type(screen.getByLabelText("新账号"), "employee");
    await user.type(screen.getByLabelText("初始密码"), "Another001");
    await user.selectOptions(screen.getByLabelText("角色"), "employee");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("账号已存在")).toBeInTheDocument();
    expect(screen.getAllByText("employee")).toHaveLength(1);
  });

  it("requires delete confirmation and supports canceling the delete", async () => {
    mockUserManagementFetch([
      { id: "cancel-id", username: "cancel_user", role: "employee", isBuiltinAdmin: false }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(user);
    await user.click(await screen.findByRole("button", { name: "删除 cancel_user" }));

    expect(screen.getByText("确认删除 cancel_user？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消删除" }));
    expect(screen.getByText("cancel_user")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 cancel_user" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.queryByText("cancel_user")).not.toBeInTheDocument();
  });

  it("lets an administrator reset an employee password but hides reset actions for admin accounts", async () => {
    mockUserManagementFetch([
      { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
      { id: "manager-id", username: "manager", role: "admin", isBuiltinAdmin: false },
      { id: "reset-id", username: "reset_user", role: "employee", isBuiltinAdmin: false }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(user);

    expect(screen.queryByRole("button", { name: "重置密码 admin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置密码 manager" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "重置密码 reset_user" }));
    await user.type(screen.getByLabelText("重置新密码"), "ResetUser001");
    await user.type(screen.getByLabelText("确认重置密码"), "ResetUser001");
    await user.click(screen.getByRole("button", { name: "提交重置" }));

    expect(await screen.findByText("密码已重置")).toBeInTheDocument();
  });

  it("allows the builtin admin to reset another administrator but blocks a manager from deleting self", async () => {
    const adminUser = { username: "admin", role: "admin" };
    mockUserManagementFetch(
      [
        { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
        { id: "manager-id", username: "manager", role: "admin", isBuiltinAdmin: false },
        { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
      ],
      [],
      adminUser
    );
    const adminActions = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(adminActions);

    expect(await screen.findByRole("button", { name: "重置密码 manager" })).toBeInTheDocument();
    await adminActions.click(screen.getByRole("button", { name: "重置密码 manager" }));
    await adminActions.type(screen.getByLabelText("重置新密码"), "ResetManager001");
    await adminActions.type(screen.getByLabelText("确认重置密码"), "ResetManager001");
    await adminActions.click(screen.getByRole("button", { name: "提交重置" }));
    expect(await screen.findByText("密码已重置")).toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    mockUserManagementFetch(
      [
        { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
        { id: "manager-id", username: "manager", role: "admin", isBuiltinAdmin: false },
        { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
      ],
      [],
      { username: "manager", role: "admin" }
    );
    const managerUser = userEvent.setup();

    render(<App />);
    await loginAsManagerAndOpenUsers(managerUser);

    await managerUser.click(await screen.findByRole("button", { name: "删除 manager" }));
    expect(await screen.findByText("不能删除当前登录管理员账号")).toBeInTheDocument();
    expect(screen.getByText("manager")).toBeInTheDocument();
  });
});

describe("Issue 3 vehicle management UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function loginAsAdminAndOpenManagement(user) {
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
  }

  it("lets an administrator create a vehicle and shows it in the registry dropdown", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      []
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    await user.click(await screen.findByRole("button", { name: "新增车辆" }));
    expect(screen.getByRole("heading", { name: "新增车辆" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("车辆编号"), "CAR-001");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10001");
    await user.type(screen.getByLabelText("品牌型号"), "大众帕萨特");
    await user.click(screen.getByRole("button", { name: "提交车辆" }));

    expect(await screen.findByText("CAR-001")).toBeInTheDocument();
    expect(screen.getByText("沪A-10001")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "CAR-001 + 沪A-10001" })).toBeInTheDocument();
  });

  it("shows duplicate vehicle code and plate number errors without changing the visible list", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      [{ id: "vehicle-id", vehicleCode: "CAR-001", plateNumber: "沪A-10001", brandModel: "大众帕萨特", isDeleted: false }]
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    await user.click(await screen.findByRole("button", { name: "新增车辆" }));
    await user.type(screen.getByLabelText("车辆编号"), "CAR-001");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10002");
    await user.type(screen.getByLabelText("品牌型号"), "丰田凯美瑞");
    await user.click(screen.getByRole("button", { name: "提交车辆" }));

    expect(await screen.findByText("车辆编号已存在")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("车辆编号"));
    await user.clear(screen.getByLabelText("车牌号码"));
    await user.type(screen.getByLabelText("车辆编号"), "CAR-002");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10001");
    await user.click(screen.getByRole("button", { name: "提交车辆" }));

    expect(await screen.findByText("车牌号已存在")).toBeInTheDocument();
    expect(screen.getAllByText("CAR-001")).toHaveLength(1);
  });

  it("requires delete confirmation and removes the vehicle from the registry dropdown after confirmation", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      [{ id: "cancel-vehicle", vehicleCode: "CAR-CANCEL", plateNumber: "沪A-CANCEL", brandModel: "别克GL8", isDeleted: false }]
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    await user.click(await screen.findByRole("button", { name: "删除车辆 CAR-CANCEL" }));

    expect(screen.getByText("确认删除车辆 CAR-CANCEL / 沪A-CANCEL？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消删除车辆" }));
    expect(screen.getByText("CAR-CANCEL")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "CAR-CANCEL + 沪A-CANCEL" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除车辆 CAR-CANCEL" }));
    await user.click(screen.getByRole("button", { name: "确认删除车辆" }));

    expect(screen.queryByText("CAR-CANCEL")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "CAR-CANCEL + 沪A-CANCEL" })).not.toBeInTheDocument();
  });
});

describe("Issue 4 registry UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function loginAsEmployee(user) {
    await user.type(screen.getByLabelText("账号"), "employee");
    await user.type(screen.getByLabelText("密码"), "Employee001");
    await user.click(screen.getByRole("button", { name: "登录" }));
  }

  async function loginAsAdmin(user) {
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
  }

  it("shows a blank start mileage for a vehicle with no history and refreshes it after a successful submit", async () => {
    const { getRecords } = mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);

    const startMileage = await screen.findByLabelText("起步公里读数");
    const endMileage = screen.getByLabelText("终点公里读数");

    expect(startMileage).toHaveValue(null);

    setDateTimeValue("testid:registry-departure-time", "2026-07-20T09:00");
    setDateTimeValue("testid:registry-return-time", "2026-07-20T10:00");
    await user.type(screen.getByLabelText("事由"), "外出办事");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-政务大厅");
    await user.type(startMileage, "1000");
    await user.type(endMileage, "1200");
    await user.type(screen.getByLabelText("驾驶员签字"), "张三");

    expect(screen.getByLabelText("行车公里数")).toHaveValue(200);

    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(await screen.findByText("登记已提交")).toBeInTheDocument();
    expect(screen.getByLabelText("车辆")).toHaveValue("vehicle-1");
    expect(screen.getByLabelText("起步公里读数")).toHaveValue(1200);
    expect(screen.getByLabelText("终点公里读数")).toHaveValue(null);
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(getRecords()).toHaveLength(1);
  });

  it("reloads independent mileage when switching vehicles and clears filled values", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-a",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        },
        {
          id: "vehicle-b",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          brandModel: "别克GL8",
          isDeleted: false
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-a": 1000,
        "vehicle-b": 500
      }
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);

    expect(await screen.findByLabelText("起步公里读数")).toHaveValue(1000);

    setDateTimeValue("出车时间", "2026-07-20T08:00");
    await user.type(screen.getByLabelText("事由"), "临时办事");
    await user.type(screen.getByLabelText("终点公里读数"), "1080");

    await user.selectOptions(screen.getByLabelText("车辆"), "vehicle-b");

    await waitFor(() => {
      expect(screen.getByLabelText("起步公里读数")).toHaveValue(500);
    });
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(screen.getByLabelText("事由")).toHaveValue("");
    expect(screen.getByLabelText("终点公里读数")).toHaveValue(null);
  });

  it("calculates distance from the current start mileage and blocks smaller end mileage", async () => {
    const { fetchMock } = mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-1": 1000
      }
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);

    const startMileage = await screen.findByLabelText("起步公里读数");
    const endMileage = screen.getByLabelText("终点公里读数");

    await user.clear(startMileage);
    await user.type(startMileage, "980");
    await user.type(endMileage, "1050");

    expect(screen.getByLabelText("行车公里数")).toHaveValue(70);

    await user.clear(endMileage);
    await user.type(endMileage, "900");
    setDateTimeValue("出车时间", "2026-07-20T09:00");
    setDateTimeValue("还车时间", "2026-07-20T10:00");
    await user.type(screen.getByLabelText("事由"), "外出办事");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-政务大厅");
    await user.type(screen.getByLabelText("驾驶员签字"), "张三");
    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect((await screen.findAllByText("终点公里不能小于起步公里")).length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === "/api/records" && options?.method === "POST"
      )
    ).toBe(false);
  });

  it("shows a stale vehicle error when the selected vehicle has been deleted before submit", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-1": 1000
      },
      submitErrorMessage: "车辆不存在或已失效"
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);

    await screen.findByLabelText("起步公里读数");
    setDateTimeValue("testid:registry-departure-time", "2026-07-20T23:00");
    setDateTimeValue("testid:registry-return-time", "2026-07-21T01:00");
    await user.type(screen.getByLabelText("事由"), "夜间值班");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-值班点");
    await user.type(screen.getByLabelText("终点公里读数"), "1100");
    await user.type(screen.getByLabelText("驾驶员签字"), "李四");
    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(await screen.findByText("车辆不存在或已失效")).toBeInTheDocument();
  });

  it("uses month-day-hour-minute inputs and shows field-level errors", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-1": 1000
      }
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);
    await screen.findByLabelText("起步公里读数");

    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(screen.getByText("出车时间必填")).toBeInTheDocument();
    expect(screen.getByText("还车时间必填")).toBeInTheDocument();
    expect(screen.getByText("事由必填")).toBeInTheDocument();

    setDateTimeValue("testid:registry-departure-time", "2026-07-20T09:00");
    setDateTimeValue("testid:registry-return-time", "2026-07-20T10:30");
    await user.type(screen.getByLabelText("事由"), "调度");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-政务大厅");
    await user.type(screen.getByLabelText("终点公里读数"), "1100");
    await user.type(screen.getByLabelText("驾驶员签字"), "张三");
    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(await screen.findByText("登记已提交")).toBeInTheDocument();
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(screen.getByLabelText("还车时间")).toHaveValue("");
  });
});

describe("Issue 5 record management UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function loginAsAdmin(user) {
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
  }

  it("shows the admin record list without edit actions", async () => {
    mockAdminRecordManagementFetch({
      users: [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ],
      records: [
        {
          id: "record-1",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "admin",
          businessDate: "2026-07-20",
          departureTime: "09:00",
          returnTime: "10:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "张三",
          remark: "",
          reason: "REC-001",
          route: "园区-政务大厅",
          isCrossDay: false,
          createdAt: "2026-07-20T10:00:00.000Z"
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-1": 1100
      }
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdmin(user);
    await user.click(await screen.findByRole("button", { name: "查看全部" }));

    const recordSection = await screen.findByRole("region", { name: "用车记录管理" });

    expect(within(recordSection).getByText("REC-001")).toBeInTheDocument();
    expect(within(recordSection).getByText("登记人：admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
  });

  it("shows records in reverse created order and supports searching and filtering", async () => {
    mockAdminRecordManagementFetch({
      users: [
        { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
        { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
      ],
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        },
        {
          id: "vehicle-2",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          brandModel: "别克GL8",
          isDeleted: false
        }
      ],
      records: [
        {
          id: "record-1",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "employee",
          businessDate: "2026-07-18",
          departureTime: "08:00",
          returnTime: "09:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "张三",
          remark: "",
          reason: "EARLIEST",
          route: "A",
          isCrossDay: false,
          createdAt: "2026-07-18T09:00:00.000Z"
        },
        {
          id: "record-2",
          vehicleId: "vehicle-2",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          registrantUsername: "admin",
          businessDate: "2026-07-19",
          departureTime: "09:00",
          returnTime: "10:00",
          startMileage: 1100,
          endMileage: 1200,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "李四",
          remark: "",
          reason: "MIDDLE",
          route: "B",
          isCrossDay: false,
          createdAt: "2026-07-19T10:00:00.000Z"
        },
        {
          id: "record-3",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "admin",
          businessDate: "2026-07-20",
          departureTime: "10:00",
          returnTime: "11:00",
          startMileage: 1200,
          endMileage: 1300,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "王五",
          remark: "",
          reason: "LATEST",
          route: "C",
          isCrossDay: false,
          createdAt: "2026-07-20T11:00:00.000Z"
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdmin(user);
    await user.click(await screen.findByRole("button", { name: "查看全部" }));

    const recordSection = screen.getByRole("region", { name: "用车记录管理" });
    const recordTitles = within(recordSection).getAllByRole("strong").map((node) => node.textContent);
    expect(recordTitles).toEqual(["LATEST", "MIDDLE", "EARLIEST"]);

    await user.type(within(recordSection).getByLabelText("搜索记录"), "MIDDLE");
    expect(within(recordSection).getByText("MIDDLE")).toBeInTheDocument();
    expect(within(recordSection).queryByText("LATEST")).not.toBeInTheDocument();

    await user.clear(within(recordSection).getByLabelText("搜索记录"));
    await user.selectOptions(within(recordSection).getByLabelText("按车辆筛选"), "CAR-001");
    expect(within(recordSection).getByText("LATEST")).toBeInTheDocument();
    expect(within(recordSection).getByText("EARLIEST")).toBeInTheDocument();
    expect(within(recordSection).queryByText("MIDDLE")).not.toBeInTheDocument();

    await user.selectOptions(within(recordSection).getByLabelText("按登记人筛选"), "admin");
    expect(within(recordSection).getByText("LATEST")).toBeInTheDocument();
    expect(within(recordSection).queryByText("EARLIEST")).not.toBeInTheDocument();

    fireEvent.change(within(recordSection).getByLabelText("按日期筛选"), {
      target: { value: "2026-07-20" }
    });
    expect(within(recordSection).getByText("LATEST")).toBeInTheDocument();

    await user.click(within(recordSection).getByRole("button", { name: "清空筛选" }));
    expect(within(recordSection).getByText("LATEST")).toBeInTheDocument();
    expect(within(recordSection).getByText("MIDDLE")).toBeInTheDocument();
    expect(within(recordSection).getByText("EARLIEST")).toBeInTheDocument();
  });

  it("supports canceling and confirming record deletion, then refreshes the start mileage", async () => {
    mockAdminRecordManagementFetch({
      users: [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false
        }
      ],
      records: [
        {
          id: "record-old",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "employee",
          businessDate: "2026-07-19",
          departureTime: "08:00",
          returnTime: "09:00",
          startMileage: 800,
          endMileage: 900,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "张三",
          remark: "",
          reason: "REC-OLD",
          route: "园区-老地点",
          isCrossDay: false,
          createdAt: "2026-07-19T09:00:00.000Z"
        },
        {
          id: "record-delete",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "employee",
          businessDate: "2026-07-20",
          departureTime: "10:00",
          returnTime: "11:00",
          startMileage: 900,
          endMileage: 1000,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "李四",
          remark: "",
          reason: "REC-DELETE",
          route: "园区-新地点",
          isCrossDay: false,
          createdAt: "2026-07-20T11:00:00.000Z"
        }
      ],
      latestMileageByVehicleId: {
        "vehicle-1": 1000
      }
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdmin(user);
    expect(await screen.findByLabelText("起步公里读数")).toHaveValue(1000);
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
    await user.click(await screen.findByRole("button", { name: "删除记录 REC-DELETE" }));

    expect(screen.getByText("确认删除记录 CAR-001 / 2026-07-20 / employee / REC-DELETE？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消删除记录" }));
    expect(screen.getByText("REC-DELETE")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除记录 REC-DELETE" }));
    await user.click(screen.getByRole("button", { name: "确认删除记录" }));

    expect(screen.queryByText("REC-DELETE")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("起步公里读数")).toHaveValue(900);
    });
  });

  it("downloads an xlsx file when the administrator exports records", async () => {
    mockAdminRecordManagementFetch({
      users: [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      records: [
        {
          id: "record-1",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "admin",
          businessDate: "2026-07-20",
          departureTime: "09:00",
          returnTime: "10:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "张三",
          remark: "",
          reason: "REC-001",
          route: "园区-政务大厅",
          isCrossDay: false,
          createdAt: "2026-07-20T10:00:00.000Z"
        }
      ]
    });
    const user = userEvent.setup();
    const createObjectUrlSpy = vi.fn(() => "blob:records");
    const revokeObjectUrlSpy = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrlSpy,
      revokeObjectURL: revokeObjectUrlSpy
    });

    render(<App />);
    await loginAsAdmin(user);
    await user.click(await screen.findByRole("button", { name: "查看全部" }));
    await user.click(await screen.findByRole("button", { name: "导出 Excel" }));

    expect(await screen.findByText("Excel 已导出")).toBeInTheDocument();
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:records");
  });
});
