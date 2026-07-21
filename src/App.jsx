import { useEffect, useState } from "react";

const roleLabels = {
  admin: "管理员",
  employee: "普通员工"
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyRegistryForm(overrides = {}) {
  return {
    businessDate: todayString(),
    departureTime: "",
    returnTime: "",
    reason: "",
    route: "",
    startMileage: "",
    endMileage: "",
    distance: "",
    fuelFee: "",
    fuelVolume: "",
    driverSignature: "",
    remark: "",
    ...overrides
  };
}

function normalizeVehicles(payload) {
  return Array.isArray(payload?.vehicles) ? payload.vehicles : [];
}

function normalizeRecords(payload) {
  return Array.isArray(payload?.records) ? payload.records : [];
}

function readRequiredText(value) {
  return String(value ?? "").trim();
}

function parseMileage(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const mileage = Number(text);

  if (!Number.isFinite(mileage) || mileage < 0) {
    return null;
  }

  return mileage;
}

function calculateDistance(startMileage, endMileage) {
  const start = parseMileage(startMileage);
  const end = parseMileage(endMileage);

  if (start === null || end === null) {
    return "";
  }

  return end - start;
}

function extractDatePart(value) {
  const text = String(value ?? "").trim();
  return text.includes("T") ? text.slice(0, 10) : "";
}

function extractTimePart(value) {
  const text = String(value ?? "").trim();
  return text.includes("T") ? text.slice(11, 16) : text;
}

function summarizeRecord(record) {
  return `${record.vehicleCode} / ${record.businessDate} / ${record.registrantUsername} / ${record.reason}`;
}

function sortRecordsDescending(records) {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function readApiMessage(response) {
  const body = await response.json().catch(() => ({}));
  return body.message ?? "请求失败，请稍后重试";
}

export function App() {
  const employeeRegistryView = "employeeRegistry";
  const adminHomeView = "adminHome";
  const adminUsersView = "adminUsers";
  const adminVehiclesView = "adminVehicles";
  const adminRecordsView = "adminRecords";
  const adminPasswordView = "adminPassword";

  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginErrors, setLoginErrors] = useState({});
  const [loginMessage, setLoginMessage] = useState("");
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordErrors, setPasswordErrors] = useState({});
  const [view, setView] = useState(employeeRegistryView);
  const [managedUsers, setManagedUsers] = useState([]);
  const [managedRecords, setManagedRecords] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [registryForm, setRegistryForm] = useState(() => createEmptyRegistryForm());
  const [registryMessage, setRegistryMessage] = useState("");
  const [registryErrors, setRegistryErrors] = useState({});
  const [userManagementMessage, setUserManagementMessage] = useState("");
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserErrors, setNewUserErrors] = useState({});
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    password: "",
    role: "employee"
  });
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [resetPasswordErrors, setResetPasswordErrors] = useState({});
  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: "",
    confirmPassword: ""
  });
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [vehicleErrors, setVehicleErrors] = useState({});
  const [vehicleForm, setVehicleForm] = useState({
    vehicleCode: "",
    plateNumber: "",
    brandModel: ""
  });
  const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState(null);
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState(null);
  const [recordFilters, setRecordFilters] = useState({
    keyword: "",
    vehicleCode: "",
    registrantUsername: "",
    businessDate: ""
  });

  useEffect(() => {
    if (!user || user.role === "admin" || view !== employeeRegistryView || !selectedVehicleId) {
      setRegistryForm(createEmptyRegistryForm());
      return undefined;
    }

    let isCurrent = true;

    async function loadLatestMileage() {
      setRegistryMessage("");
      setRegistryForm(createEmptyRegistryForm());

      const response = await fetch(`/api/vehicles/${selectedVehicleId}/latest-mileage`, {
        credentials: "include"
      });

      if (!isCurrent) {
        return;
      }

      if (!response.ok) {
        setRegistryMessage(await readApiMessage(response));
        setRegistryForm(createEmptyRegistryForm());
        return;
      }

      const body = await response.json();
      setRegistryForm(
        createEmptyRegistryForm({
          startMileage:
            body.startMileage === null || body.startMileage === undefined
              ? ""
              : String(body.startMileage)
        })
      );
    }

    loadLatestMileage();

    return () => {
      isCurrent = false;
    };
  }, [user, selectedVehicleId]);

  function updateLoginField(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
    setLoginErrors((current) => ({ ...current, [field]: "" }));
  }

  function closeInlinePanels() {
    setIsPasswordDialogOpen(false);
    setIsAddUserOpen(false);
    setPendingDeleteUser(null);
    setResetUser(null);
    setIsAddVehicleOpen(false);
    setPendingDeleteVehicle(null);
    setPendingDeleteRecord(null);
  }

  function resetPasswordModuleState() {
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordErrors({});
    setPasswordMessage("");
  }

  function resetAdminModuleState() {
    closeInlinePanels();
    setUserManagementMessage("");
    resetPasswordModuleState();
  }

  function updatePasswordField(field, value) {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: "" }));
    setPasswordMessage("");
  }

  function updateNewUserField(field, value) {
    setNewUserForm((current) => ({ ...current, [field]: value }));
    setNewUserErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage("");
  }

  function updateResetPasswordField(field, value) {
    setResetPasswordForm((current) => ({ ...current, [field]: value }));
    setResetPasswordErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage("");
  }

  function updateVehicleField(field, value) {
    setVehicleForm((current) => ({ ...current, [field]: value }));
    setVehicleErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage("");
  }

  function updateRegistryField(field, value) {
    setRegistryForm((current) => {
      const next = {
        ...current,
        [field]: value
      };

      if (field === "startMileage" || field === "endMileage") {
        next.distance = calculateDistance(next.startMileage, next.endMileage);
      }

      return next;
    });
    setRegistryErrors((current) => ({ ...current, [field]: "" }));
    setRegistryMessage("");
  }

  function updateRecordFilter(field, value) {
    setRecordFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function clearRecordFilters() {
    setRecordFilters({
      keyword: "",
      vehicleCode: "",
      registrantUsername: "",
      businessDate: ""
    });
  }

  async function loadVehicles({ preserveSelection = true } = {}) {
    const response = await fetch("/api/vehicles", {
      credentials: "include"
    });

    if (!response.ok) {
      return [];
    }

    const body = await response.json();
    const nextVehicles = normalizeVehicles(body);

    setVehicles(nextVehicles);
    setSelectedVehicleId((current) => {
      if (nextVehicles.length === 0) {
        return "";
      }

      if (preserveSelection && nextVehicles.some((vehicle) => vehicle.id === current)) {
        return current;
      }

      return nextVehicles[0].id;
    });

    return nextVehicles;
  }

  async function loadRecords() {
    const response = await fetch("/api/records", {
      credentials: "include"
    });

    if (!response.ok) {
      setManagedRecords([]);
      return [];
    }

    const body = await response.json();
    const nextRecords = normalizeRecords(body);

    setManagedRecords(nextRecords);
    return nextRecords;
  }

  async function handleExportRecords() {
    const response = await fetch("/api/records/export", {
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "vehicle-records.xlsx";
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setUserManagementMessage("Excel 已导出");
  }

  async function refreshSelectedVehicleMileage() {
    if (!selectedVehicleId) {
      return;
    }

    const response = await fetch(`/api/vehicles/${selectedVehicleId}/latest-mileage`, {
      credentials: "include"
    });

    if (!response.ok) {
      return;
    }

    const body = await response.json();
    const nextStartMileage =
      body.startMileage === null || body.startMileage === undefined ? "" : String(body.startMileage);

    setRegistryForm((current) => ({
      ...current,
      startMileage: nextStartMileage,
      distance: calculateDistance(nextStartMileage, current.endMileage)
    }));
  }

  async function handleLogin(event) {
    event.preventDefault();

    const errors = {};
    if (!loginForm.username.trim()) {
      errors.username = "账号必填";
    }
    if (!loginForm.password) {
      errors.password = "密码必填";
    }

    setLoginErrors(errors);
    setLoginMessage("");

    if (Object.keys(errors).length > 0) {
      return;
    }

    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(loginForm)
    });

    if (!response.ok) {
      setLoginMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json();
    const nextUser = body.user;

    setUser(nextUser);
    resetAdminModuleState();
    setLoginForm({ username: "", password: "" });
    setRegistryMessage("");
    setRegistryErrors({});

    if (nextUser.role === "admin") {
      setView(adminHomeView);
      setVehicles([]);
      setSelectedVehicleId("");
      setRegistryForm(createEmptyRegistryForm());
      return;
    }

    setView(employeeRegistryView);
    await loadVehicles({ preserveSelection: false });
  }

  async function handleLogout() {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include"
    });
    setUser(null);
    resetAdminModuleState();
    setView(employeeRegistryView);
    setManagedUsers([]);
    setManagedRecords([]);
    setVehicles([]);
    setSelectedVehicleId("");
    setRegistryForm(createEmptyRegistryForm());
    setRegistryErrors({});
    setRegistryMessage("");
    setLoginMessage("");
  }

  async function handleChangePassword(event) {
    event.preventDefault();

    const errors = {};

    if (!passwordForm.currentPassword) {
      errors.currentPassword = "当前密码必填";
    }
    if (!passwordForm.newPassword) {
      errors.newPassword = "新密码必填";
    }
    if (!passwordForm.confirmPassword) {
      errors.confirmPassword = "确认新密码必填";
    }

    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage("两次新密码不一致");
      return;
    }

    if (passwordForm.newPassword === passwordForm.currentPassword) {
      setPasswordMessage("新密码不能与当前密码相同");
      return;
    }

    const response = await fetch("/api/change-password", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(passwordForm)
    });

    if (!response.ok) {
      setPasswordMessage(await readApiMessage(response));
      return;
    }

    const message = await readApiMessage(response);
    setUser(null);
    setView(employeeRegistryView);
    resetAdminModuleState();
    setLoginMessage(message);
  }

  function openAdminHome() {
    resetAdminModuleState();
    setView(adminHomeView);
  }

  async function openAdminUsers() {
    resetAdminModuleState();

    const response = await fetch("/api/users", {
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json();
    setManagedUsers(body.users);
    setView(adminUsersView);
  }

  async function openAdminVehicles() {
    resetAdminModuleState();

    await loadVehicles();
    setView(adminVehiclesView);
  }

  async function openAdminRecords() {
    resetAdminModuleState();

    const response = await fetch("/api/records", {
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json();
    setManagedRecords(normalizeRecords(body));
    clearRecordFilters();
    setView(adminRecordsView);
  }

  function openAdminPasswordModule() {
    resetAdminModuleState();
    setView(adminPasswordView);
  }

  async function handleCreateUser(event) {
    event.preventDefault();

    const errors = {};

    if (!newUserForm.username.trim()) {
      errors.username = "新账号必填";
    }
    if (!newUserForm.password) {
      errors.password = "初始密码必填";
    }
    if (!newUserForm.role) {
      errors.role = "角色必填";
    }

    if (Object.keys(errors).length > 0) {
      setNewUserErrors(errors);
      return;
    }

    const response = await fetch("/api/users", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(newUserForm)
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json();
    setManagedUsers((current) => [...current, body.user]);
    setNewUserForm({ username: "", password: "", role: "employee" });
    setNewUserErrors({});
    setIsAddUserOpen(false);
    setUserManagementMessage("用户已新增");
  }

  async function handleCreateVehicle(event) {
    event.preventDefault();

    const errors = {};

    if (!vehicleForm.vehicleCode.trim()) {
      errors.vehicleCode = "车辆编号必填";
    }
    if (!vehicleForm.plateNumber.trim()) {
      errors.plateNumber = "车牌号码必填";
    }
    if (!vehicleForm.brandModel.trim()) {
      errors.brandModel = "品牌型号必填";
    }

    if (Object.keys(errors).length > 0) {
      setVehicleErrors(errors);
      return;
    }

    const response = await fetch("/api/vehicles", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(vehicleForm)
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json();
    setVehicles((current) =>
      [...current, body.vehicle].sort((left, right) => left.vehicleCode.localeCompare(right.vehicleCode))
    );
    setSelectedVehicleId((current) => current || body.vehicle.id);
    setVehicleForm({ vehicleCode: "", plateNumber: "", brandModel: "" });
    setVehicleErrors({});
    setIsAddVehicleOpen(false);
    setUserManagementMessage("车辆已新增");
  }

  async function confirmDeleteUser() {
    if (!pendingDeleteUser) {
      return;
    }

    const response = await fetch(`/api/users/${pendingDeleteUser.id}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    setManagedUsers((current) =>
      current.filter((managedUser) => managedUser.id !== pendingDeleteUser.id)
    );
    setPendingDeleteUser(null);
    setUserManagementMessage("用户已删除");
  }

  async function confirmDeleteVehicle() {
    if (!pendingDeleteVehicle) {
      return;
    }

    const deletingVehicleId = pendingDeleteVehicle.id;
    let remainingVehicles = [];

    const response = await fetch(`/api/vehicles/${deletingVehicleId}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    setVehicles((current) => {
      remainingVehicles = current.filter((vehicle) => vehicle.id !== deletingVehicleId);
      return remainingVehicles;
    });
    setPendingDeleteVehicle(null);
    setSelectedVehicleId((current) =>
      current === deletingVehicleId ? remainingVehicles[0]?.id ?? "" : current
    );
    setUserManagementMessage("车辆已删除");
  }

  async function confirmDeleteRecord() {
    if (!pendingDeleteRecord) {
      return;
    }

    const deletedVehicleId = pendingDeleteRecord.vehicleId;
    const response = await fetch(`/api/records/${pendingDeleteRecord.id}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    setManagedRecords((current) => current.filter((record) => record.id !== pendingDeleteRecord.id));
    setPendingDeleteRecord(null);
    setUserManagementMessage("记录已删除");

    if (deletedVehicleId === selectedVehicleId) {
      await refreshSelectedVehicleMileage();
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();

    const errors = {};

    if (!resetPasswordForm.newPassword) {
      errors.newPassword = "重置新密码必填";
    }
    if (!resetPasswordForm.confirmPassword) {
      errors.confirmPassword = "确认重置密码必填";
    }

    if (Object.keys(errors).length > 0) {
      setResetPasswordErrors(errors);
      return;
    }

    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      setUserManagementMessage("两次新密码不一致");
      return;
    }

    const response = await fetch(`/api/users/${resetUser.id}/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resetPasswordForm)
    });

    if (!response.ok) {
      setUserManagementMessage(await readApiMessage(response));
      return;
    }

    setResetUser(null);
    setResetPasswordErrors({});
    setResetPasswordForm({ newPassword: "", confirmPassword: "" });
    setUserManagementMessage("密码已重置");
  }

  async function handleRegistrySubmit(event) {
    event.preventDefault();

    const errors = {};

    if (!selectedVehicleId) {
      errors.vehicleId = "请先选择车辆";
    }

    const businessDate = readRequiredText(registryForm.businessDate);
    const departureDate = extractDatePart(registryForm.departureTime);
    const returnDate = extractDatePart(registryForm.returnTime);
    const departureTime = extractTimePart(registryForm.departureTime);
    const returnTime = extractTimePart(registryForm.returnTime);
    const reason = readRequiredText(registryForm.reason);
    const route = readRequiredText(registryForm.route);
    const driverSignature = readRequiredText(registryForm.driverSignature);
    const startMileage = parseMileage(registryForm.startMileage);
    const endMileage = parseMileage(registryForm.endMileage);

    if (!businessDate) {
      errors.businessDate = "日期必填";
    }
    if (!departureTime) {
      errors.departureTime = "出车时间必填";
    }
    if (!returnTime) {
      errors.returnTime = "还车时间必填";
    }
    if (!reason) {
      errors.reason = "事由必填";
    }
    if (!route) {
      errors.route = "目的地及行车路线必填";
    }
    if (startMileage === null) {
      errors.startMileage = "起步公里必填";
    }
    if (endMileage === null) {
      errors.endMileage = "终点公里必填";
    }
    if (!driverSignature) {
      errors.driverSignature = "驾驶员签字必填";
    }

    if (Object.keys(errors).length > 0) {
      setRegistryErrors(errors);
      return;
    }

    if (endMileage < startMileage) {
      setRegistryErrors((current) => ({
        ...current,
        endMileage: "终点公里不能小于起步公里"
      }));
      setRegistryMessage("终点公里不能小于起步公里");
      return;
    }

    const response = await fetch("/api/records", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        vehicleId: selectedVehicleId,
        businessDate,
        departureDate,
        departureTime: registryForm.departureTime,
        returnDate,
        returnTime: registryForm.returnTime,
        reason,
        route,
        startMileage,
        endMileage,
        fuelFee: registryForm.fuelFee.trim(),
        fuelVolume: registryForm.fuelVolume.trim(),
        driverSignature,
        remark: registryForm.remark.trim()
      })
    });

    if (!response.ok) {
      setRegistryMessage(await readApiMessage(response));
      return;
    }

    const body = await response.json().catch(() => ({}));
    const nextStartMileage =
      body.record?.endMileage === null || body.record?.endMileage === undefined
        ? String(endMileage)
        : String(body.record.endMileage);

    setRegistryMessage(body.message ?? "登记已提交");
    setRegistryErrors({});
    setRegistryForm(
      createEmptyRegistryForm({
        startMileage: nextStartMileage
      })
    );
  }

  const filteredManagedRecords = sortRecordsDescending(managedRecords).filter((record) => {
    const keyword = recordFilters.keyword.trim().toLowerCase();
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

    const matchesVehicle = recordFilters.vehicleCode
      ? record.vehicleCode === recordFilters.vehicleCode
      : true;
    const matchesUser = recordFilters.registrantUsername
      ? record.registrantUsername === recordFilters.registrantUsername
      : true;
    const matchesDate = recordFilters.businessDate
      ? record.businessDate === recordFilters.businessDate
      : true;

    return matchesKeyword && matchesVehicle && matchesUser && matchesDate;
  });

  if (!user) {
    return (
      <main className="shell">
        <section className="panel auth-panel">
          <p className="eyebrow">Issue 1</p>
          <h1>公务用车使用登记系统</h1>
          <p className="lede">请使用账号密码登录，进入用车登记工作台。</p>

          <form className="form" onSubmit={handleLogin} noValidate>
            <label className="field">
              <span>账号</span>
              <input
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) => updateLoginField("username", event.target.value)}
              />
              {loginErrors.username ? <small className="error">{loginErrors.username}</small> : null}
            </label>

            <label className="field">
              <span>密码</span>
              <input
                autoComplete="current-password"
                type="password"
                value={loginForm.password}
                onChange={(event) => updateLoginField("password", event.target.value)}
              />
              {loginErrors.password ? <small className="error">{loginErrors.password}</small> : null}
            </label>

            {loginMessage ? <p className="message">{loginMessage}</p> : null}

            <button className="primary-button" type="submit">
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className="shell">
        <section className="panel workspace-panel">
          <div>
            <p className="eyebrow">登记工作台</p>
            <h1>公务用车使用登记</h1>
            <p className="lede">填写当次用车信息后提交，系统会按车辆独立维护默认起步公里。</p>
          </div>

          <div className="identity-card" aria-label="当前登录信息">
            <p>当前用户：{user.username}</p>
            <p>当前角色：{roleLabels[user.role] ?? user.role}</p>
          </div>

          <form className="form registry-form" onSubmit={handleRegistrySubmit} noValidate>
            <label className="field registry-vehicle-field">
              <span>车辆</span>
              <select
                aria-label="车辆"
                value={selectedVehicleId}
                onChange={(event) => {
                  setSelectedVehicleId(event.target.value);
                  setRegistryMessage("");
                }}
              >
                {vehicles.length === 0 ? <option value="">暂无可用车辆</option> : null}
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.vehicleCode} + {vehicle.plateNumber}
                  </option>
                ))}
              </select>
              {registryErrors.vehicleId ? <small className="error">{registryErrors.vehicleId}</small> : null}
            </label>

            <div className="field-grid">
              <label className="field">
                <span>日期</span>
                <input
                  aria-label="日期"
                  type="date"
                  value={registryForm.businessDate}
                  onChange={(event) => updateRegistryField("businessDate", event.target.value)}
                />
                {registryErrors.businessDate ? (
                  <small className="error">{registryErrors.businessDate}</small>
                ) : null}
              </label>
              <label className="field">
                <span>出车时间</span>
                <input
                  aria-label="出车时间"
                  data-testid="registry-departure-time"
                  type="datetime-local"
                  value={registryForm.departureTime}
                  onChange={(event) => updateRegistryField("departureTime", event.target.value)}
                />
                {registryErrors.departureTime ? (
                  <small className="error">{registryErrors.departureTime}</small>
                ) : null}
              </label>
              <label className="field">
                <span>还车时间</span>
                <input
                  aria-label="还车时间"
                  data-testid="registry-return-time"
                  type="datetime-local"
                  value={registryForm.returnTime}
                  onChange={(event) => updateRegistryField("returnTime", event.target.value)}
                />
                {registryErrors.returnTime ? (
                  <small className="error">{registryErrors.returnTime}</small>
                ) : null}
              </label>
              <label className="field">
                <span>事由</span>
                <input
                  aria-label="事由"
                  value={registryForm.reason}
                  onChange={(event) => updateRegistryField("reason", event.target.value)}
                />
                {registryErrors.reason ? <small className="error">{registryErrors.reason}</small> : null}
              </label>
              <label className="field field-span-2">
                <span>目的地及行车路线</span>
                <input
                  aria-label="目的地及行车路线"
                  value={registryForm.route}
                  onChange={(event) => updateRegistryField("route", event.target.value)}
                />
                {registryErrors.route ? <small className="error">{registryErrors.route}</small> : null}
              </label>
              <label className="field">
                <span>起步公里读数</span>
                <input
                  aria-label="起步公里读数"
                  type="number"
                  min="0"
                  value={registryForm.startMileage}
                  onChange={(event) => updateRegistryField("startMileage", event.target.value)}
                />
                {registryErrors.startMileage ? (
                  <small className="error">{registryErrors.startMileage}</small>
                ) : null}
              </label>
              <label className="field">
                <span>终点公里读数</span>
                <input
                  aria-label="终点公里读数"
                  type="number"
                  min="0"
                  value={registryForm.endMileage}
                  onChange={(event) => updateRegistryField("endMileage", event.target.value)}
                />
                {registryErrors.endMileage ? (
                  <small className="error">{registryErrors.endMileage}</small>
                ) : null}
              </label>
              <label className="field">
                <span>行车公里数</span>
                <input aria-label="行车公里数" readOnly type="number" value={registryForm.distance} />
              </label>
              <label className="field">
                <span>驾驶员签字</span>
                <input
                  aria-label="驾驶员签字"
                  value={registryForm.driverSignature}
                  onChange={(event) => updateRegistryField("driverSignature", event.target.value)}
                />
                {registryErrors.driverSignature ? (
                  <small className="error">{registryErrors.driverSignature}</small>
                ) : null}
              </label>
              <label className="field">
                <span>加油费用</span>
                <input
                  aria-label="加油费用"
                  value={registryForm.fuelFee}
                  onChange={(event) => updateRegistryField("fuelFee", event.target.value)}
                />
              </label>
              <label className="field">
                <span>加油数量</span>
                <input
                  aria-label="加油数量"
                  value={registryForm.fuelVolume}
                  onChange={(event) => updateRegistryField("fuelVolume", event.target.value)}
                />
              </label>
              <label className="field field-span-2">
                <span>备注</span>
                <input
                  aria-label="备注"
                  value={registryForm.remark}
                  onChange={(event) => updateRegistryField("remark", event.target.value)}
                />
              </label>
            </div>

            {registryMessage ? <p className="message">{registryMessage}</p> : null}

            <div className="action-row">
              <button className="primary-button" type="submit">
                提交登记
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const shouldOpen = !isPasswordDialogOpen;
                  closeInlinePanels();
                  setPasswordMessage("");
                  setPasswordErrors({});
                  setIsPasswordDialogOpen(shouldOpen);
                }}
              >
                修改密码
              </button>
              <button className="ghost-button" type="button" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          </form>

          {isPasswordDialogOpen ? (
            <form className="password-dialog inline-panel" onSubmit={handleChangePassword} noValidate>
              <h2>修改密码</h2>
              <label className="field">
                <span>当前密码</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) => updatePasswordField("currentPassword", event.target.value)}
                />
                {passwordErrors.currentPassword ? (
                  <small className="error">{passwordErrors.currentPassword}</small>
                ) : null}
              </label>
              <label className="field">
                <span>新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => updatePasswordField("newPassword", event.target.value)}
                />
                {passwordErrors.newPassword ? (
                  <small className="error">{passwordErrors.newPassword}</small>
                ) : null}
              </label>
              <label className="field">
                <span>确认新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => updatePasswordField("confirmPassword", event.target.value)}
                />
                {passwordErrors.confirmPassword ? (
                  <small className="error">{passwordErrors.confirmPassword}</small>
                ) : null}
              </label>

              {passwordMessage ? <p className="message">{passwordMessage}</p> : null}

              <div className="action-row">
                <button className="primary-button" type="submit">
                  提交修改
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setIsPasswordDialogOpen(false);
                    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    setPasswordErrors({});
                    setPasswordMessage("");
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="panel workspace-panel">
        <div>
          <p className="eyebrow">管理工作台</p>
          <h1>管理员管理工作台</h1>
          <p className="lede">请选择要进入的管理模块。管理员登录后不再进入公务车登记表单。</p>
        </div>

        <div className="identity-card" aria-label="当前登录信息">
          <p>当前用户：{user.username}</p>
          <p>当前角色：{roleLabels[user.role] ?? user.role}</p>
        </div>

        <div className="action-row admin-toolbar">
          {view !== adminHomeView ? (
            <button className="secondary-button" type="button" onClick={openAdminHome}>
              返回管理首页
            </button>
          ) : null}
          <button className="ghost-button" type="button" onClick={handleLogout}>
            退出登录
          </button>
        </div>

        {view === adminHomeView ? (
          <section className="management-panel" aria-label="管理员导航">
            {userManagementMessage ? <p className="message">{userManagementMessage}</p> : null}

            <div className="admin-nav-grid">
              <button className="secondary-button admin-nav-card" type="button" onClick={openAdminUsers}>
                用户账号管理
              </button>
              <button className="secondary-button admin-nav-card" type="button" onClick={openAdminVehicles}>
                公车档案管理
              </button>
              <button className="secondary-button admin-nav-card" type="button" onClick={openAdminRecords}>
                用车记录管理
              </button>
              <button className="secondary-button admin-nav-card" type="button" onClick={openAdminPasswordModule}>
                修改密码
              </button>
            </div>
          </section>
        ) : null}

        {view === adminUsersView ? (
          <section className="management-panel" aria-label="用户账号管理">
            <div className="section-heading">
              <div>
                <p className="eyebrow">管理模块</p>
                <h2>用户账号管理</h2>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  const shouldOpen = !isAddUserOpen;
                  closeInlinePanels();
                  setNewUserErrors({});
                  setUserManagementMessage("");
                  setIsAddUserOpen(shouldOpen);
                }}
              >
                新增用户
              </button>
            </div>

            {userManagementMessage ? <p className="message">{userManagementMessage}</p> : null}

            <div className="user-list">
              {managedUsers.length === 0 ? <p className="empty-state">暂无用户</p> : null}
              {managedUsers.map((managedUser) => {
                const canResetPassword =
                  managedUser.username !== user.username &&
                  (managedUser.role === "employee" || user.username === "admin");
                const canDeleteUser =
                  !managedUser.isBuiltinAdmin &&
                  !(managedUser.username === user.username && user.username !== "admin");

                return (
                  <article className="user-row" key={managedUser.id}>
                    <div>
                      <strong>{managedUser.username}</strong>
                      <p>{roleLabels[managedUser.role] ?? managedUser.role}</p>
                      {managedUser.isBuiltinAdmin ? <small>内置账号</small> : null}
                    </div>
                    <div className="action-row">
                      {canResetPassword ? (
                        <button
                          aria-label={`重置密码 ${managedUser.username}`}
                          className="secondary-button"
                          type="button"
                          onClick={() => {
                            const isCurrent = resetUser?.id === managedUser.id;
                            closeInlinePanels();
                            setResetPasswordErrors({});
                            setResetPasswordForm({ newPassword: "", confirmPassword: "" });
                            setUserManagementMessage("");
                            setResetUser(isCurrent ? null : managedUser);
                          }}
                        >
                          重置密码
                        </button>
                      ) : null}
                      {!managedUser.isBuiltinAdmin ||
                      (managedUser.username === user.username && user.username !== "admin") ? (
                        <button
                          aria-label={`删除 ${managedUser.username}`}
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            if (managedUser.username === user.username && user.username !== "admin") {
                              setUserManagementMessage("不能删除当前登录管理员账号");
                              return;
                            }

                            const isCurrent = pendingDeleteUser?.id === managedUser.id;
                            closeInlinePanels();
                            setUserManagementMessage("");
                            setPendingDeleteUser(isCurrent ? null : managedUser);
                          }}
                        >
                          删除
                        </button>
                      ) : null}
                      {!canDeleteUser && managedUser.id === user.id && user.username !== "admin" ? (
                        <small>当前账号不可自删</small>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            {isAddUserOpen ? (
              <form className="password-dialog inline-panel" onSubmit={handleCreateUser} noValidate>
                <h2>新增用户</h2>
                <label className="field">
                  <span>新账号</span>
                  <input
                    autoComplete="off"
                    value={newUserForm.username}
                    onChange={(event) => updateNewUserField("username", event.target.value)}
                  />
                  {newUserErrors.username ? <small className="error">{newUserErrors.username}</small> : null}
                </label>
                <label className="field">
                  <span>初始密码</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    value={newUserForm.password}
                    onChange={(event) => updateNewUserField("password", event.target.value)}
                  />
                  {newUserErrors.password ? <small className="error">{newUserErrors.password}</small> : null}
                </label>
                <label className="field">
                  <span>角色</span>
                  <select
                    value={newUserForm.role}
                    onChange={(event) => updateNewUserField("role", event.target.value)}
                  >
                    <option value="employee">普通员工</option>
                    <option value="admin">管理员</option>
                  </select>
                  {newUserErrors.role ? <small className="error">{newUserErrors.role}</small> : null}
                </label>
                <div className="action-row">
                  <button className="primary-button" type="submit">
                    提交新增
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsAddUserOpen(false);
                      setNewUserErrors({});
                      setNewUserForm({ username: "", password: "", role: "employee" });
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : null}

            {pendingDeleteUser ? (
              <section className="password-dialog inline-panel" aria-label="删除用户确认">
                <h2>删除用户</h2>
                <p>确认删除 {pendingDeleteUser.username}？</p>
                <div className="action-row">
                  <button className="primary-button" type="button" onClick={confirmDeleteUser}>
                    确认删除
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setPendingDeleteUser(null)}>
                    取消删除
                  </button>
                </div>
              </section>
            ) : null}

            {resetUser ? (
              <form className="password-dialog inline-panel" onSubmit={handleResetPassword} noValidate>
                <h2>重置 {resetUser.username} 密码</h2>
                <label className="field">
                  <span>重置新密码</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    value={resetPasswordForm.newPassword}
                    onChange={(event) => updateResetPasswordField("newPassword", event.target.value)}
                  />
                  {resetPasswordErrors.newPassword ? (
                    <small className="error">{resetPasswordErrors.newPassword}</small>
                  ) : null}
                </label>
                <label className="field">
                  <span>确认重置密码</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    value={resetPasswordForm.confirmPassword}
                    onChange={(event) => updateResetPasswordField("confirmPassword", event.target.value)}
                  />
                  {resetPasswordErrors.confirmPassword ? (
                    <small className="error">{resetPasswordErrors.confirmPassword}</small>
                  ) : null}
                </label>
                <div className="action-row">
                  <button className="primary-button" type="submit">
                    提交重置
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setResetUser(null);
                      setResetPasswordErrors({});
                      setResetPasswordForm({ newPassword: "", confirmPassword: "" });
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ) : null}

        {view === adminVehiclesView ? (
          <section className="management-panel" aria-label="公车档案管理">
            <div className="section-heading">
              <div>
                <p className="eyebrow">管理模块</p>
                <h2>公车档案管理</h2>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  const shouldOpen = !isAddVehicleOpen;
                  closeInlinePanels();
                  setVehicleErrors({});
                  setUserManagementMessage("");
                  setIsAddVehicleOpen(shouldOpen);
                }}
              >
                新增车辆
              </button>
            </div>

            {userManagementMessage ? <p className="message">{userManagementMessage}</p> : null}

            <div className="user-list">
              {vehicles.length === 0 ? <p className="empty-state">暂无车辆</p> : null}
              {vehicles.map((vehicle) => (
                <article className="user-row" key={vehicle.id}>
                  <div>
                    <strong>{vehicle.vehicleCode}</strong>
                    <p>{vehicle.plateNumber}</p>
                    <small>{vehicle.brandModel}</small>
                  </div>
                  <div className="action-row">
                    <button
                      aria-label={`删除车辆 ${vehicle.vehicleCode}`}
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        const isCurrent = pendingDeleteVehicle?.id === vehicle.id;
                        closeInlinePanels();
                        setUserManagementMessage("");
                        setPendingDeleteVehicle(isCurrent ? null : vehicle);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {isAddVehicleOpen ? (
              <form className="password-dialog inline-panel" onSubmit={handleCreateVehicle} noValidate>
                <h2>新增车辆</h2>
                <label className="field">
                  <span>车辆编号</span>
                  <input
                    autoComplete="off"
                    value={vehicleForm.vehicleCode}
                    onChange={(event) => updateVehicleField("vehicleCode", event.target.value)}
                  />
                  {vehicleErrors.vehicleCode ? (
                    <small className="error">{vehicleErrors.vehicleCode}</small>
                  ) : null}
                </label>
                <label className="field">
                  <span>车牌号码</span>
                  <input
                    autoComplete="off"
                    value={vehicleForm.plateNumber}
                    onChange={(event) => updateVehicleField("plateNumber", event.target.value)}
                  />
                  {vehicleErrors.plateNumber ? (
                    <small className="error">{vehicleErrors.plateNumber}</small>
                  ) : null}
                </label>
                <label className="field">
                  <span>品牌型号</span>
                  <input
                    autoComplete="off"
                    value={vehicleForm.brandModel}
                    onChange={(event) => updateVehicleField("brandModel", event.target.value)}
                  />
                  {vehicleErrors.brandModel ? (
                    <small className="error">{vehicleErrors.brandModel}</small>
                  ) : null}
                </label>
                <div className="action-row">
                  <button className="primary-button" type="submit">
                    提交车辆
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsAddVehicleOpen(false);
                      setVehicleErrors({});
                      setVehicleForm({ vehicleCode: "", plateNumber: "", brandModel: "" });
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : null}

            {pendingDeleteVehicle ? (
              <section className="password-dialog inline-panel" aria-label="删除车辆确认">
                <h2>删除车辆</h2>
                <p>
                  确认删除车辆 {pendingDeleteVehicle.vehicleCode} / {pendingDeleteVehicle.plateNumber}？
                </p>
                <div className="action-row">
                  <button className="primary-button" type="button" onClick={confirmDeleteVehicle}>
                    确认删除车辆
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setPendingDeleteVehicle(null);
                    }}
                  >
                    取消删除车辆
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {view === adminRecordsView ? (
          <section className="management-panel" aria-label="用车记录管理">
            <div className="section-heading">
              <div>
                <p className="eyebrow">管理模块</p>
                <h2>用车记录管理</h2>
              </div>
              <button className="primary-button" type="button" onClick={handleExportRecords}>
                导出 Excel
              </button>
            </div>

            {userManagementMessage ? <p className="message">{userManagementMessage}</p> : null}

            <div className="filter-grid">
              <label className="field">
                <span>搜索记录</span>
                <input
                  value={recordFilters.keyword}
                  onChange={(event) => updateRecordFilter("keyword", event.target.value)}
                />
              </label>
              <label className="field">
                <span>按车辆筛选</span>
                <select
                  value={recordFilters.vehicleCode}
                  onChange={(event) => updateRecordFilter("vehicleCode", event.target.value)}
                >
                  <option value="">全部车辆</option>
                  {[...new Set(managedRecords.map((record) => record.vehicleCode))].map((vehicleCode) => (
                    <option key={vehicleCode} value={vehicleCode}>
                      {vehicleCode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>按登记人筛选</span>
                <select
                  value={recordFilters.registrantUsername}
                  onChange={(event) => updateRecordFilter("registrantUsername", event.target.value)}
                >
                  <option value="">全部登记人</option>
                  {[...new Set(managedRecords.map((record) => record.registrantUsername))].map((username) => (
                    <option key={username} value={username}>
                      {username}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>按日期筛选</span>
                <input
                  aria-label="按日期筛选"
                  type="date"
                  value={recordFilters.businessDate}
                  onChange={(event) => updateRecordFilter("businessDate", event.target.value)}
                />
              </label>
            </div>

            <div className="action-row">
              <button className="ghost-button" type="button" onClick={clearRecordFilters}>
                清空筛选
              </button>
            </div>

            <div className="user-list">
              {filteredManagedRecords.length === 0 ? (
                <p className="empty-state">暂无符合条件的记录</p>
              ) : null}
              {filteredManagedRecords.map((record) => (
                <article className="user-row" key={record.id}>
                  <div>
                    <strong role="strong">{record.reason}</strong>
                    <p>
                      车辆：{record.vehicleCode} / {record.plateNumber}
                    </p>
                    <p>登记人：{record.registrantUsername}</p>
                    <p>路线：{record.route}</p>
                    <p>
                      加油：{record.fuelFee ?? "-"} / {record.fuelVolume ?? "-"}
                    </p>
                    <p>驾驶员：{record.driverSignature}</p>
                    <small>
                      {record.businessDate} {record.departureTime}-{record.returnTime} · {record.distance} 公里
                      {record.isCrossDay ? " · 跨天" : ""}
                      {record.remark ? ` · ${record.remark}` : ""}
                    </small>
                  </div>
                  <div className="action-row">
                    <button
                      aria-label={`删除记录 ${record.reason}`}
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        const isCurrent = pendingDeleteRecord?.id === record.id;
                        closeInlinePanels();
                        setUserManagementMessage("");
                        setPendingDeleteRecord(isCurrent ? null : record);
                      }}
                    >
                      删除记录
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {pendingDeleteRecord ? (
              <section className="password-dialog inline-panel" aria-label="删除记录确认">
                <h2>删除记录</h2>
                <p>确认删除记录 {summarizeRecord(pendingDeleteRecord)}？</p>
                <div className="action-row">
                  <button className="primary-button" type="button" onClick={confirmDeleteRecord}>
                    确认删除记录
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setPendingDeleteRecord(null);
                    }}
                  >
                    取消删除记录
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {view === adminPasswordView ? (
          <section className="management-panel" aria-label="修改密码">
            <div>
              <p className="eyebrow">管理模块</p>
              <h2>修改密码</h2>
            </div>

            <form className="password-dialog" onSubmit={handleChangePassword} noValidate>
              <label className="field">
                <span>当前密码</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) => updatePasswordField("currentPassword", event.target.value)}
                />
                {passwordErrors.currentPassword ? (
                  <small className="error">{passwordErrors.currentPassword}</small>
                ) : null}
              </label>
              <label className="field">
                <span>新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => updatePasswordField("newPassword", event.target.value)}
                />
                {passwordErrors.newPassword ? (
                  <small className="error">{passwordErrors.newPassword}</small>
                ) : null}
              </label>
              <label className="field">
                <span>确认新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => updatePasswordField("confirmPassword", event.target.value)}
                />
                {passwordErrors.confirmPassword ? (
                  <small className="error">{passwordErrors.confirmPassword}</small>
                ) : null}
              </label>

              {passwordMessage ? <p className="message">{passwordMessage}</p> : null}

              <div className="action-row">
                <button className="primary-button" type="submit">
                  提交修改
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </section>
    </main>
  );
}
