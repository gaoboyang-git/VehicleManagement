/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.jsx";

const NativeURL = globalThis.URL;
const TEST_SIGNATURE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

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

function parseMockUrl(url) {
  return new NativeURL(url, "http://localhost");
}

function filterRecords(records, filters) {
  const keyword = String(filters.keyword ?? "").trim().toLowerCase();

  return records.filter((record) => {
    const matchesKeyword = keyword
      ? [
          record.reason,
          record.route,
          record.vehicleCode,
          record.plateNumber,
          record.registrantUsername,
          record.driverSignature,
          record.remark ?? ""
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      : true;

    const matchesVehicle = filters.vehicleCode ? record.vehicleCode === filters.vehicleCode : true;
    const matchesUser = filters.registrantUsername
      ? record.registrantUsername === filters.registrantUsername
      : true;
    const matchesDate = filters.businessDate ? record.businessDate === filters.businessDate : true;

    return matchesKeyword && matchesVehicle && matchesUser && matchesDate;
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
    const requestUrl = parseMockUrl(url);
    const pathname = requestUrl.pathname;
    const method = options.method ?? "GET";

    if (pathname === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (pathname === "/api/users" && method === "GET") {
      return okJson({ users });
    }

    if (pathname === "/api/vehicles" && method === "GET") {
      return okJson({ vehicles });
    }

    if (pathname === "/api/users" && method === "POST") {
      const body = JSON.parse(options.body);
      if (users.some((existingUser) => existingUser.username === body.username)) {
        return failJson(409, { message: "账号已存在" });
      }
      const createdUser = {
        id: `id-${body.username}`,
        fullName: body.fullName || body.username,
        username: body.username,
        role: body.role,
        isBuiltinAdmin: false
      };
      users = [...users, createdUser];
      return okJson({ user: createdUser });
    }

    if (pathname.startsWith("/api/users/") && pathname.endsWith("/reset-password")) {
      const id = pathname.split("/").at(-2);
      const target = users.find((user) => user.id === id);

      if (
        target?.role === "admin" &&
        loginUser.username !== "admin"
      ) {
        return failJson(400, { message: "只能重置普通用户密码" });
      }

      return okJson({ message: "密码已重置" });
    }

    if (pathname.startsWith("/api/users/") && method === "DELETE") {
      const id = pathname.split("/").at(-1);
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

    if (pathname === "/api/vehicles" && method === "POST") {
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
        status: body.status ?? "available",
        isDeleted: false
      };
      vehicles = [...vehicles, createdVehicle];
      return okJson({ vehicle: createdVehicle });
    }

    if (pathname.startsWith("/api/vehicles/") && pathname.endsWith("/status") && method === "PATCH") {
      const id = pathname.split("/").at(-2);
      const body = JSON.parse(options.body);
      const status = body.status;
      const target = vehicles.find((vehicle) => vehicle.id === id);

      if (!target) {
        return failJson(404, { message: "车辆不存在或已失效" });
      }

      if (!["available", "inUse"].includes(status)) {
        return failJson(400, { message: "车辆状态非法" });
      }

      vehicles = vehicles.map((vehicle) =>
        vehicle.id === id ? { ...vehicle, status } : vehicle
      );

      return okJson({
        vehicle: vehicles.find((vehicle) => vehicle.id === id)
      });
    }

    if (pathname.startsWith("/api/vehicles/") && method === "DELETE") {
      const id = pathname.split("/").at(-1);
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
    const requestUrl = parseMockUrl(url);
    const pathname = requestUrl.pathname;
    const method = options.method ?? "GET";

    if (pathname === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (pathname === "/api/vehicles" && method === "GET") {
      return okJson({
        vehicles: vehicles.filter((vehicle) => !vehicle.isDeleted)
      });
    }

    if (
      pathname.startsWith("/api/vehicles/") &&
      pathname.endsWith("/latest-mileage") &&
      method === "GET"
    ) {
      const parts = pathname.split("/");
      const vehicleId = parts.at(-2);
      const vehicle = vehicles.find((item) => item.id === vehicleId && !item.isDeleted);

      if (!vehicle) {
        return failJson(404, { message: "车辆不存在或已失效" });
      }

      return okJson({
        startMileage: Object.hasOwn(mileageByVehicleId, vehicleId) ? mileageByVehicleId[vehicleId] : null
      });
    }

    if (pathname === "/api/records" && method === "POST") {
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
      const businessDate = extractDatePart(body.departureTime) || body.businessDate;
      const departureTime = body.departureTime;
      const returnTime = body.returnTime;

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
        businessDate,
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
    type: "application/pdf"
  })
} = {}) {
  let nextUsers = [...users];
  let nextVehicles = [...vehicles];
  let nextRecords = [...records];
  let mileageByVehicleId = { ...latestMileageByVehicleId };

  return mockFetch((url, options = {}) => {
    const requestUrl = parseMockUrl(url);
    const pathname = requestUrl.pathname;
    const method = options.method ?? "GET";

    if (pathname === "/api/login") {
      return okJson({ user: loginUser });
    }

    if (pathname === "/api/users" && method === "GET") {
      return okJson({ users: nextUsers });
    }

    if (pathname === "/api/vehicles" && method === "GET") {
      return okJson({ vehicles: nextVehicles.filter((vehicle) => !vehicle.isDeleted) });
    }

    if (
      pathname.startsWith("/api/vehicles/") &&
      pathname.endsWith("/latest-mileage") &&
      method === "GET"
    ) {
      const vehicleId = pathname.split("/").at(-2);
      return okJson({
        startMileage: Object.hasOwn(mileageByVehicleId, vehicleId) ? mileageByVehicleId[vehicleId] : null
      });
    }

    if (pathname === "/api/records" && method === "GET") {
      const filters = {
        keyword: requestUrl.searchParams.get("keyword") ?? "",
        vehicleCode: requestUrl.searchParams.get("vehicleCode") ?? "",
        registrantUsername: requestUrl.searchParams.get("registrantUsername") ?? "",
        businessDate: requestUrl.searchParams.get("businessDate") ?? ""
      };

      return okJson({
        records: filterRecords(nextRecords, filters)
      });
    }

    if (pathname === "/api/records/export" && method === "GET") {
      return okBlob(exportBlob);
    }

    if (pathname === "/api/records/batch-delete" && method === "POST") {
      const body = JSON.parse(options.body);
      const ids = Array.isArray(body.ids) ? body.ids : [];

      if (ids.length === 0) {
        return failJson(400, { message: "请选择至少一条记录" });
      }

      const existingIds = new Set(nextRecords.map((record) => record.id));
      if (ids.some((id) => !existingIds.has(id))) {
        return failJson(404, { message: "记录不存在" });
      }

      nextRecords = nextRecords.filter((record) => !ids.includes(record.id));
      return okJson({ message: `已删除 ${ids.length} 条记录`, deletedCount: ids.length });
    }

    if (pathname.startsWith("/api/records/") && method === "DELETE") {
      const id = pathname.split("/").at(-1);
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
    vi.useRealTimers();
  });

  it("does not submit login when username and password are blank", async () => {
    const fetchMock = mockFetch(() => okJson({}));
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("账号必填")).toBeInTheDocument();
    expect(screen.getByText("密码必填")).toBeInTheDocument();
    expect(screen.getByText("© 2026 公务用车管理平台 · 版权所有")).toBeInTheDocument();
  });

  it("toggles password visibility on the login form", async () => {
    const user = userEvent.setup();

    render(<App />);

    const passwordInput = screen.getByLabelText("密码");
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("renders login failures with the error banner style", async () => {
    mockFetch(() => failJson(401, { message: "账号或密码错误" }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const banner = await screen.findByText("账号或密码错误");
    expect(banner).toHaveClass("banner-message", "banner-message-error");
  });

  it("shows the management entry after an administrator logs in", async () => {
    mockFetch(() => okJson({ user: { username: "admin", role: "admin" } }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "管理员工作台" })).toBeInTheDocument();
    expect(screen.getByText("当前用户：admin")).toBeInTheDocument();
    expect(screen.getByText("当前角色：管理员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户账号管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "公车档案管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用车记录管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改密码" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看全部" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交登记" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
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

  it("blocks weak self-service passwords for employees before submitting", async () => {
    const fetchMock = mockFetch(() => okJson({ user: { username: "employee", role: "employee" } }));
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "employee");
    await user.type(screen.getByLabelText("密码"), "Employee001");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "修改密码" }));
    await user.type(screen.getByLabelText("当前密码"), "Employee001");
    await user.type(screen.getByLabelText("新密码"), "abcdef");
    await user.type(screen.getByLabelText("确认新密码"), "abcdef");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(screen.getByText("新密码需至少 6 位且同时包含字母和数字")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets an administrator change the password from the admin home module", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/login") {
        return okJson({ user: { username: "admin", role: "admin" } });
      }
      return okJson({ message: "密码已修改，请重新登录" });
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "修改密码" }));

    expect(await screen.findByRole("dialog", { name: "修改密码" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "管理员工作台" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("当前密码"), "admin");
    await user.type(screen.getByLabelText("新密码"), "NewAdmin001");
    await user.type(screen.getByLabelText("确认新密码"), "NewAdmin001");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("密码已修改，请重新登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("blocks weak self-service passwords for administrators before submitting", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === "/api/login") {
        return okJson({ user: { username: "admin", role: "admin" } });
      }

      return okJson({ message: "密码已修改，请重新登录" });
    });
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "修改密码" }));
    await user.type(screen.getByLabelText("当前密码"), "admin");
    await user.type(screen.getByLabelText("新密码"), "123456");
    await user.type(screen.getByLabelText("确认新密码"), "123456");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(screen.getByText("新密码需至少 6 位且同时包含字母和数字")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await user.click(await screen.findByRole("button", { name: "用户账号管理" }));
  }

  async function loginAsManagerAndOpenUsers(user) {
    await user.type(screen.getByLabelText("账号"), "manager");
    await user.type(screen.getByLabelText("密码"), "Manager001");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(await screen.findByRole("button", { name: "用户账号管理" }));
  }

  it("lets an administrator create an employee with a weak password and toggle visibility", async () => {
    mockUserManagementFetch([
      { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenUsers(user);
    await user.click(await screen.findByRole("button", { name: "新增用户" }));

    expect(screen.getByRole("heading", { name: "新增用户" })).toBeInTheDocument();

    const passwordInput = screen.getByLabelText("初始密码");
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示初始密码" }));
    expect(passwordInput).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏初始密码" }));
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.type(screen.getByLabelText("新账号"), "new_employee");
    await user.type(screen.getByLabelText("用户姓名"), "新员工");
    await user.type(screen.getByLabelText("初始密码"), "123");
    await user.selectOptions(screen.getByLabelText("角色"), "employee");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("新员工")).toBeInTheDocument();
    expect(screen.getByText("账号：new_employee")).toBeInTheDocument();
    expect(screen.getByText("普通员工")).toBeInTheDocument();
  });

  it("switches modules from the admin home and closes inline forms", async () => {
    mockUserManagementFetch([
      { id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true },
      { id: "employee-id", username: "employee", role: "employee", isBuiltinAdmin: false }
    ]);
    const user = userEvent.setup();

    render(<App />);
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "管理员工作台" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "用户账号管理" }));
    expect(await screen.findByRole("heading", { name: "用户账号管理" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增用户" }));
    expect(screen.getByRole("heading", { name: "新增用户" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回管理首页" }));
    expect(await screen.findByRole("heading", { name: "管理员工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "新增用户" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "公车档案管理" }));
    expect(await screen.findByRole("heading", { name: "公车档案管理" })).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("用户姓名"), "重复账号");
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

    expect(screen.getByText("确认删除账号「cancel_user」？此操作不可撤销。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("cancel_user")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 cancel_user" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.queryByText("cancel_user")).not.toBeInTheDocument();
  });

  it("lets an administrator reset an employee password with a weak value and hides reset actions for admin accounts", async () => {
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
    const resetInput = screen.getByLabelText("新密码");
    expect(resetInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示新密码" }));
    expect(resetInput).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏新密码" }));
    expect(resetInput).toHaveAttribute("type", "password");
    await user.type(resetInput, "abc");
    await user.type(screen.getByLabelText("确认新密码"), "abc");
    await user.click(screen.getByRole("button", { name: "确认重置" }));

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
    await adminActions.type(screen.getByLabelText("新密码"), "ResetManager001");
    await adminActions.type(screen.getByLabelText("确认新密码"), "ResetManager001");
    await adminActions.click(screen.getByRole("button", { name: "确认重置" }));
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
    await user.click(await screen.findByRole("button", { name: "公车档案管理" }));
  }

  it("lets an administrator create a vehicle inside the vehicle management module", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      []
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    await user.click(await screen.findByRole("button", { name: "新增车辆" }));
    expect(screen.getByRole("heading", { name: "新增车辆" })).toBeInTheDocument();
    expect(screen.getByText("新增车辆默认状态为空闲中")).toBeInTheDocument();
    expect(screen.queryByText("车辆状态")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("车辆编号"), "CAR-001");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10001");
    await user.type(screen.getByLabelText("品牌型号"), "大众帕萨特");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("沪A-10001")).toBeInTheDocument();
    expect(screen.getByText("大众帕萨特")).toBeInTheDocument();
    expect(screen.getByText("空闲中")).toBeInTheDocument();
  });

  it("shows duplicate vehicle code and plate number errors without changing the visible list", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      [
        {
          id: "vehicle-id",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          isDeleted: false,
          status: "idle"
        }
      ]
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    expect(await screen.findByText("使用中")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "新增车辆" }));
    await user.type(screen.getByLabelText("车辆编号"), "CAR-001");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10002");
    await user.type(screen.getByLabelText("品牌型号"), "丰田凯美瑞");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("车辆编号已存在")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("车辆编号"));
    await user.clear(screen.getByLabelText("车牌号码"));
    await user.type(screen.getByLabelText("车辆编号"), "CAR-002");
    await user.type(screen.getByLabelText("车牌号码"), "沪A-10001");
    await user.click(screen.getByRole("button", { name: "提交新增" }));

    expect(await screen.findByText("车牌号已存在")).toBeInTheDocument();
    expect(screen.getAllByText("沪A-10001")).toHaveLength(1);
  });

  it("requires delete confirmation and removes the vehicle from the vehicle management list after confirmation", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      [{ id: "cancel-vehicle", vehicleCode: "CAR-CANCEL", plateNumber: "沪A-CANCEL", brandModel: "别克GL8", isDeleted: false }]
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);
    await user.click(await screen.findByRole("button", { name: "删除车辆 CAR-CANCEL" }));

    expect(screen.getByText("确认删除车辆「沪A-CANCEL-别克GL8」？此操作不可撤销。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("沪A-CANCEL")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除车辆 CAR-CANCEL" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.queryByText("沪A-CANCEL")).not.toBeInTheDocument();
  });

  it("lets an administrator switch a vehicle between free and in-use labels", async () => {
    mockUserManagementFetch(
      [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      [
        {
          id: "vehicle-id",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
          isDeleted: false
        }
      ]
    );
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenManagement(user);

    expect(await screen.findByText("空闲中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设为使用中 CAR-001" }));
    expect(screen.getByText("确认将车辆「沪A-10001-大众帕萨特」设为使用中？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认操作" }));

    expect(await screen.findByText("使用中")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设为空闲中 CAR-001" }));
    expect(screen.getByText("确认将车辆「沪A-10001-大众帕萨特」设为空闲中？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认操作" }));

    expect(await screen.findByText("空闲中")).toBeInTheDocument();
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

  it("shows a blank start mileage for a vehicle with no history and refreshes it after a successful submit", async () => {
    const { getRecords } = mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
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
    expect(endMileage).toHaveValue(null);

    setDateTimeValue("testid:registry-departure-time", "2026-07-20T09:00");
    setDateTimeValue("testid:registry-return-time", "2026-07-20T10:00");
    await user.type(screen.getByLabelText("事由"), "外出办事");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-政务大厅");
    await user.type(startMileage, "1000");
    await user.type(endMileage, "1200");
    expect(screen.getByLabelText("驾驶员手写签字")).toBeInTheDocument();

    expect(screen.getByLabelText("行车公里数")).toHaveValue(200);

    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(await screen.findByText("登记已提交")).toBeInTheDocument();
    expect(screen.getByLabelText("车辆")).toHaveValue("vehicle-1");
    expect(screen.getByLabelText("起步公里读数")).toHaveValue(1200);
    expect(screen.getByLabelText("终点公里读数")).toHaveValue(1200);
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(getRecords()).toHaveLength(1);
    expect(getRecords()[0]).toEqual(
      expect.objectContaining({
        businessDate: "2026-07-20",
        departureTime: "2026-07-20T09:00",
        returnTime: "2026-07-20T10:00"
      })
    );
  });

  it("reloads independent mileage when switching vehicles and clears filled values", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-a",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
          isDeleted: false
        },
        {
          id: "vehicle-b",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          brandModel: "别克GL8",
          status: "available",
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
    expect(screen.getByLabelText("终点公里读数")).toHaveValue(1000);

    setDateTimeValue("出车时间", "2026-07-20T08:00");
    await user.type(screen.getByLabelText("事由"), "临时办事");
    await user.type(screen.getByLabelText("终点公里读数"), "1080");

    await user.selectOptions(screen.getByLabelText("车辆"), "vehicle-b");

    await waitFor(() => {
      expect(screen.getByLabelText("起步公里读数")).toHaveValue(500);
    });
    expect(screen.getByLabelText("终点公里读数")).toHaveValue(500);
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(screen.getByLabelText("事由")).toHaveValue("");
  });

  it("calculates distance from the current start mileage and blocks smaller end mileage", async () => {
    const { fetchMock } = mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
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
    expect(screen.getByLabelText("驾驶员手写签字")).toBeInTheDocument();
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
          status: "available",
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
    expect(screen.getByLabelText("驾驶员手写签字")).toBeInTheDocument();
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
          status: "available",
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
    expect(screen.getByLabelText("驾驶员手写签字")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect(await screen.findByText("登记已提交")).toBeInTheDocument();
    expect(screen.getByLabelText("出车时间")).toHaveValue("");
    expect(screen.getByLabelText("还车时间")).toHaveValue("");
  });

  it("blocks submits when the return time is earlier than the departure time", async () => {
    const { fetchMock } = mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
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

    setDateTimeValue("testid:registry-departure-time", "2026-07-20T10:30");
    setDateTimeValue("testid:registry-return-time", "2026-07-20T09:00");
    await user.type(screen.getByLabelText("事由"), "调度");
    await user.type(screen.getByLabelText("目的地及行车路线"), "园区-政务大厅");
    await user.type(screen.getByLabelText("终点公里读数"), "1100");
    expect(screen.getByLabelText("驾驶员手写签字")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提交登记" }));

    expect((await screen.findAllByText("还车时间不能小于出车时间")).length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === "/api/records" && options?.method === "POST"
      )
    ).toBe(false);
  });

  it("shows fuel units and uses numeric fields for fuel inputs", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
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

    const fuelFeeInput = screen.getByLabelText("加油费用（元）");
    const fuelVolumeInput = screen.getByLabelText("加油数量（升）");

    expect(fuelFeeInput).toHaveAttribute("type", "number");
    expect(fuelVolumeInput).toHaveAttribute("type", "number");
    expect(screen.queryByRole("button", { name: "修改姓名" })).not.toBeInTheDocument();

    await user.type(fuelFeeInput, "15.5");
    await user.type(fuelVolumeInput, "20.3");

    expect(fuelFeeInput).toHaveValue(15.5);
    expect(fuelVolumeInput).toHaveValue(20.3);
  });

  it("shows all active vehicles in the employee registry selector and warns on in-use vehicles", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-a",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
          isDeleted: false
        },
        {
          id: "vehicle-b",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          brandModel: "别克GL8",
          status: "inUse",
          isDeleted: false
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);

    const vehicleSelect = await screen.findByLabelText("车辆");

    expect(within(vehicleSelect).getByRole("option", { name: "沪A-10001-大众帕萨特" })).toBeInTheDocument();
    expect(within(vehicleSelect).getByRole("option", { name: "沪A-10002-别克GL8" })).toBeInTheDocument();

    await user.selectOptions(vehicleSelect, "vehicle-b");
    expect(await screen.findByText("当前车辆为使用中状态，请确认后登记")).toBeInTheDocument();
  });

  it("opens a fullscreen signature sheet for easier mobile handwriting and closes it", async () => {
    mockRegistryFetch({
      vehicles: [
        {
          id: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          status: "available",
          isDeleted: false
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsEmployee(user);
    await screen.findByLabelText("驾驶员手写签字");

    await user.click(screen.getAllByRole("button", { name: "全屏书写" })[0]);

    expect(await screen.findByRole("dialog", { name: "全屏签字" })).toBeInTheDocument();
    expect(screen.getByLabelText("全屏驾驶员手写签字")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "完成书写" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "全屏签字" })).not.toBeInTheDocument();
    });
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

  async function loginAsAdminAndOpenRecords(user) {
    await loginAsAdmin(user);
    await user.click(await screen.findByRole("button", { name: "用车记录管理" }));
  }

  it("shows compact admin record cards and expands a record to reveal full details", async () => {
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
          departureTime: "2026-07-20T09:00",
          returnTime: "2026-07-20T10:00",
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
    await loginAsAdminAndOpenRecords(user);

    const recordSection = await screen.findByRole("region", { name: "用车记录管理" });

    expect(within(recordSection).getByText("2026-07-20 · REC-001")).toBeInTheDocument();
    expect(within(recordSection).queryByText("加油：0元/0L")).not.toBeInTheDocument();
    expect(within(recordSection).queryByRole("button", { name: "删除记录 REC-001" })).not.toBeInTheDocument();

    await user.click(within(recordSection).getByRole("button", { name: "查看记录 REC-001" }));

    expect(within(recordSection).getByText("加油：0元/0L")).toBeInTheDocument();
    expect(within(recordSection).getByText("2026-07-20 09:00-2026-07-20 10:00 · 100 公里")).toBeInTheDocument();
    expect(within(recordSection).getByRole("button", { name: "删除记录 REC-001" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
  });

  it("opens a larger signature preview from the record detail panel and closes it", async () => {
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
          id: "record-signature",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特",
          registrantUsername: "admin",
          registrantName: "王麻子",
          businessDate: "2026-07-20",
          departureTime: "2026-07-20T09:00",
          returnTime: "2026-07-20T10:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "15",
          fuelVolume: "20",
          driverSignature: "王麻子",
          driverSignatureImage: TEST_SIGNATURE_IMAGE,
          remark: "",
          reason: "签字预览",
          route: "园区-政务大厅",
          isCrossDay: false,
          createdAt: "2026-07-20T10:00:00.000Z"
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenRecords(user);

    const recordSection = await screen.findByRole("region", { name: "用车记录管理" });
    await user.click(within(recordSection).getByRole("button", { name: "查看记录 签字预览" }));
    await user.click(screen.getByRole("button", { name: "放大查看王麻子的手写签字" }));

    expect(screen.getByRole("dialog", { name: "王麻子的手写签字" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭王麻子的手写签字" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "王麻子的手写签字" })).not.toBeInTheDocument();
    });
  });

  it("formats legacy time-only records with full business dates in the expanded detail", async () => {
    mockAdminRecordManagementFetch({
      users: [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      records: [
        {
          id: "record-legacy",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "admin",
          businessDate: "2026-07-20",
          departureTime: "23:00",
          returnTime: "01:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "张三",
          remark: "",
          reason: "LEGACY",
          route: "园区-值班点",
          isCrossDay: true,
          createdAt: "2026-07-20T23:30:00.000Z"
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenRecords(user);

    const recordSection = await screen.findByRole("region", { name: "用车记录管理" });
    await user.click(within(recordSection).getByRole("button", { name: "查看记录 LEGACY" }));

    expect(
      within(recordSection).getByText("2026-07-20 23:00-2026-07-21 01:00 · 100 公里 · 跨天")
    ).toBeInTheDocument();
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
          brandModel: "大众帕萨特",
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
          brandModel: "别克GL8",
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
          brandModel: "大众帕萨特",
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
    await loginAsAdminAndOpenRecords(user);

    const recordSection = screen.getByRole("region", { name: "用车记录管理" });
    const recordTitles = within(recordSection)
      .getAllByRole("button", { name: /查看记录 / })
      .map((node) => node.getAttribute("aria-label")?.replace("查看记录 ", ""));
    expect(recordTitles).toEqual(["LATEST", "MIDDLE", "EARLIEST"]);
    expect(within(recordSection).getByRole("option", { name: "沪A-10001-大众帕萨特" })).toBeInTheDocument();
    expect(within(recordSection).getByRole("option", { name: "沪A-10002-别克GL8" })).toBeInTheDocument();
    expect(
      within(within(recordSection).getByRole("button", { name: "查看记录 LATEST" })).getByText("沪A-10001-大众帕萨特")
    ).toBeInTheDocument();
    expect(
      within(within(recordSection).getByRole("button", { name: "查看记录 MIDDLE" })).getByText("沪A-10002-别克GL8")
    ).toBeInTheDocument();

    await user.type(within(recordSection).getByLabelText("搜索记录"), "MIDDLE");
    expect(within(recordSection).getByRole("button", { name: "查看记录 MIDDLE" })).toBeInTheDocument();
    expect(within(recordSection).queryByRole("button", { name: "查看记录 LATEST" })).not.toBeInTheDocument();

    await user.clear(within(recordSection).getByLabelText("搜索记录"));
    await user.selectOptions(within(recordSection).getByLabelText("按车辆筛选"), "CAR-001");
    expect(within(recordSection).getByRole("button", { name: "查看记录 LATEST" })).toBeInTheDocument();
    expect(within(recordSection).getByRole("button", { name: "查看记录 EARLIEST" })).toBeInTheDocument();
    expect(within(recordSection).queryByRole("button", { name: "查看记录 MIDDLE" })).not.toBeInTheDocument();

    await user.selectOptions(within(recordSection).getByLabelText("按登记人筛选"), "admin");
    expect(within(recordSection).getByRole("button", { name: "查看记录 LATEST" })).toBeInTheDocument();
    expect(within(recordSection).queryByRole("button", { name: "查看记录 EARLIEST" })).not.toBeInTheDocument();

    fireEvent.change(within(recordSection).getByLabelText("按日期筛选"), {
      target: { value: "2026-07-20" }
    });
    expect(within(recordSection).getByRole("button", { name: "查看记录 LATEST" })).toBeInTheDocument();

    await user.click(within(recordSection).getByRole("button", { name: "清空筛选" }));
    expect(within(recordSection).getByRole("button", { name: "查看记录 LATEST" })).toBeInTheDocument();
    expect(within(recordSection).getByRole("button", { name: "查看记录 MIDDLE" })).toBeInTheDocument();
    expect(within(recordSection).getByRole("button", { name: "查看记录 EARLIEST" })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "管理员工作台" })).toBeInTheDocument();
    expect(screen.queryByLabelText("起步公里读数")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "用车记录管理" }));
    await user.click(await screen.findByRole("button", { name: "查看记录 REC-DELETE" }));
    await user.click(await screen.findByRole("button", { name: "删除记录 REC-DELETE" }));

    expect(
      screen.getByText("确认删除记录「CAR-001 / 2026-07-20 / employee / REC-DELETE」？此操作不可撤销。")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "删除记录 REC-DELETE" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除记录 REC-DELETE" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.queryByRole("button", { name: "删除记录 REC-DELETE" })).not.toBeInTheDocument();
  });

  it("supports selecting filtered records for batch deletion and clears selection when filters change", async () => {
    mockAdminRecordManagementFetch({
      users: [{ id: "admin-id", username: "admin", role: "admin", isBuiltinAdmin: true }],
      records: [
        {
          id: "record-a",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "employee",
          businessDate: "2026-07-20",
          departureTime: "09:00",
          returnTime: "10:00",
          startMileage: 1000,
          endMileage: 1100,
          distance: 100,
          fuelFee: "15",
          fuelVolume: "20",
          driverSignature: "张三",
          remark: "",
          reason: "BULK-A",
          route: "A",
          isCrossDay: false,
          createdAt: "2026-07-20T10:00:00.000Z"
        },
        {
          id: "record-b",
          vehicleId: "vehicle-1",
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          registrantUsername: "employee",
          businessDate: "2026-07-20",
          departureTime: "10:00",
          returnTime: "11:00",
          startMileage: 1100,
          endMileage: 1200,
          distance: 100,
          fuelFee: "0",
          fuelVolume: "0",
          driverSignature: "李四",
          remark: "",
          reason: "BULK-B",
          route: "B",
          isCrossDay: false,
          createdAt: "2026-07-20T11:00:00.000Z"
        },
        {
          id: "record-c",
          vehicleId: "vehicle-2",
          vehicleCode: "CAR-002",
          plateNumber: "沪A-10002",
          registrantUsername: "admin",
          businessDate: "2026-07-21",
          departureTime: "12:00",
          returnTime: "13:00",
          startMileage: 500,
          endMileage: 580,
          distance: 80,
          fuelFee: "8",
          fuelVolume: "12",
          driverSignature: "王五",
          remark: "",
          reason: "OTHER",
          route: "C",
          isCrossDay: false,
          createdAt: "2026-07-21T13:00:00.000Z"
        }
      ]
    });
    const user = userEvent.setup();

    render(<App />);
    await loginAsAdminAndOpenRecords(user);

    const recordSection = screen.getByRole("region", { name: "用车记录管理" });
    await user.type(within(recordSection).getByLabelText("搜索记录"), "BULK");

    await user.click(within(recordSection).getByRole("button", { name: "全选当前筛选结果" }));
    expect(within(recordSection).getByText("已选 2 条")).toBeInTheDocument();
    expect(recordSection.querySelector(".checkbox-shell")).toHaveClass("checkbox-shell-active");

    await user.click(within(recordSection).getByRole("button", { name: "批量删除" }));
    expect(screen.getByText("确认删除已选 2 条记录？此操作不可撤销。")).toBeInTheDocument();

    fireEvent.change(within(recordSection).getByLabelText("按日期筛选"), {
      target: { value: "2026-07-21" }
    });
    expect(within(recordSection).getByText("已选 0 条")).toBeInTheDocument();
    expect(screen.queryByText("确认删除已选 2 条记录？此操作不可撤销。")).not.toBeInTheDocument();

    await user.clear(within(recordSection).getByLabelText("搜索记录"));
    fireEvent.change(within(recordSection).getByLabelText("按日期筛选"), {
      target: { value: "" }
    });
    await user.click(within(recordSection).getByRole("button", { name: "全选当前筛选结果" }));
    await user.click(within(recordSection).getByRole("button", { name: "批量删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByText("已删除 3 条记录")).toBeInTheDocument();
    expect(screen.queryByText("BULK-A")).not.toBeInTheDocument();
    expect(screen.queryByText("BULK-B")).not.toBeInTheDocument();
    expect(screen.queryByText("OTHER")).not.toBeInTheDocument();
  });

  it("downloads a pdf file using the current record filters", async () => {
    const fetchMock = mockAdminRecordManagementFetch({
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
    await loginAsAdminAndOpenRecords(user);
    await user.type(screen.getByLabelText("搜索记录"), "REC-001");
    await user.selectOptions(screen.getByLabelText("按车辆筛选"), "CAR-001");
    fireEvent.change(screen.getByLabelText("按日期筛选"), {
      target: { value: "2026-07-20" }
    });
    await user.click(await screen.findByRole("button", { name: "导出 PDF" }));

    const exportBanner = await screen.findByText("PDF 已导出");
    expect(exportBanner).toHaveClass("banner-message", "banner-message-success");
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          url ===
          "/api/records/export?keyword=REC-001&vehicleCode=CAR-001&registrantUsername=&businessDate=2026-07-20"
      )
    ).toBe(true);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0].download).toMatch(/^用车记录-\d{4}年\d{2}月\d{2}日\.pdf$/);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:records");
  });
});
