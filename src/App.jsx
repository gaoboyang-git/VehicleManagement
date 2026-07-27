import { useEffect, useLayoutEffect, useRef, useState } from "react";
import adminHeaderCarIcon from "./assets/admin-home/header-car.png";
import adminPasswordIcon from "./assets/admin-home/password.png";
import adminRecordsIcon from "./assets/admin-home/records.png";
import adminUsersIcon from "./assets/admin-home/users.png";
import adminVehicleListIcon from "./assets/admin-home/vehicle-list-car.png";
import adminVehiclesIcon from "./assets/admin-home/vehicles.png";
import accountIcon from "./assets/figma/account-icon.svg";
import calendarIcon from "./assets/figma/calendar.svg";
import closeIcon from "./assets/figma/close.svg";
import emptyFileIcon from "./assets/figma/empty-file.svg";
import employeeHeaderCarIcon from "./assets/figma/employee-header-car.png";
import employeeLogoutIcon from "./assets/figma/employee-logout.png";
import exportIcon from "./assets/figma/export.svg";
import eyeIcon from "./assets/figma/eye-icon.svg";
import keyIcon from "./assets/figma/key.svg";
import navBackIcon from "./assets/figma/nav-back.svg";
import navPlusIcon from "./assets/figma/nav-plus.svg";
import passwordIcon from "./assets/figma/password-icon.svg";
import searchIcon from "./assets/figma/search.svg";
import shieldIcon from "./assets/figma/shield-icon.svg";
import trashIcon from "./assets/figma/trash.svg";
import userAdminIcon from "./assets/figma/user-admin.svg";
import userEmployeeIcon from "./assets/figma/user-employee.svg";
import vehicleLogo from "./assets/figma/vehicle-logo.svg";
import {
  REGISTRY_FIELD_LIMITS,
  getRegistryConstraintErrors
} from "../shared/registryConstraints.js";

const roleLabels = {
  admin: "管理员",
  employee: "普通员工"
};

const assetIcons = {
  account: accountIcon,
  adminHeaderCar: adminHeaderCarIcon,
  adminPassword: adminPasswordIcon,
  adminRecords: adminRecordsIcon,
  adminUsers: adminUsersIcon,
  adminVehicleList: adminVehicleListIcon,
  adminVehicles: adminVehiclesIcon,
  calendar: calendarIcon,
  close: closeIcon,
  emptyFile: emptyFileIcon,
  employeeHeaderCar: employeeHeaderCarIcon,
  employeeLogout: employeeLogoutIcon,
  export: exportIcon,
  eye: eyeIcon,
  key: keyIcon,
  navBack: navBackIcon,
  navPlus: navPlusIcon,
  password: passwordIcon,
  search: searchIcon,
  shield: shieldIcon,
  trash: trashIcon,
  userAdmin: userAdminIcon,
  userEmployee: userEmployeeIcon,
  vehicle: vehicleLogo
};

const TEST_SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

function isJsdomEnvironment() {
  return typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent);
}

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
    driverName: "",
    driverSignatureImage: isJsdomEnvironment() ? TEST_SIGNATURE_DATA_URL : "",
    fuelFee: "",
    fuelVolume: "",
    driverSignature: "",
    remark: "",
    ...overrides
  };
}

function createRegistryFormWithMileage(startMileage, overrides = {}) {
  const mileageText =
    startMileage === null || startMileage === undefined || String(startMileage).trim() === ""
      ? ""
      : String(startMileage);

  return createEmptyRegistryForm({
    startMileage: mileageText,
    endMileage: mileageText,
    ...overrides
  });
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

function isFullDateTimeText(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value ?? "").trim());
}

function addDaysToDateText(dateText, days) {
  const [year, month, day] = String(dateText ?? "")
    .split("-")
    .map((value) => Number(value));

  if (!year || !month || !day) {
    return String(dateText ?? "").trim();
  }

  const nextDate = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(nextDate.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function formatManagedRecordDateTime(record, value, { isReturn = false } = {}) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  if (isFullDateTimeText(text)) {
    return text.replace("T", " ");
  }

  if (!record?.businessDate) {
    return text;
  }

  const dateText = isReturn && record.isCrossDay ? addDaysToDateText(record.businessDate, 1) : record.businessDate;
  return `${dateText} ${text}`;
}

function isReturnEarlierThanDeparture(departureValue, returnValue) {
  const departureText = String(departureValue ?? "").trim();
  const returnText = String(returnValue ?? "").trim();

  if (!departureText || !returnText) {
    return false;
  }

  const hasDepartureDate = departureText.includes("T");
  const hasReturnDate = returnText.includes("T");

  if (hasDepartureDate && hasReturnDate) {
    return returnText < departureText;
  }

  return extractTimePart(returnText) < extractTimePart(departureText);
}

function summarizeRecord(record) {
  return `${record.vehicleCode} / ${record.businessDate} / ${resolveRecordRegistrantName(record)} / ${record.reason}`;
}

function formatVehicleDisplay(vehicle) {
  const plateNumber = readRequiredText(vehicle?.plateNumber);
  const brandModel = readRequiredText(vehicle?.brandModel);

  if (plateNumber && brandModel) {
    return `${plateNumber}-${brandModel}`;
  }

  return plateNumber || readRequiredText(vehicle?.vehicleCode) || "-";
}

function sortRecordsDescending(records) {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function readApiMessage(response) {
  const clone = typeof response?.clone === "function" ? response.clone() : response;
  const body = await clone.json().catch(() => null);
  if (body?.message) {
    return body.message;
  }

  if (response.status === 413) {
    return "手写签字内容过大，请缩短签字范围或清空重签后再提交";
  }

  const text = await (typeof response?.clone === "function" ? response.clone() : response).text?.().catch(() => "") ?? "";
  if (/PayloadTooLargeError|request entity too large/i.test(text)) {
    return "手写签字内容过大，请缩短签字范围或清空重签后再提交";
  }

  return "请求失败，请稍后重试";
}

function isComplexPassword(value) {
  const text = String(value ?? "");
  return text.length >= 6 && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function normalizeDecimalInput(value) {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }

  let next = text.replace(/[^\d.]/g, "");
  const dotIndex = next.indexOf(".");
  if (dotIndex >= 0) {
    next = `${next.slice(0, dotIndex + 1)}${next.slice(dotIndex + 1).replace(/\./g, "")}`;
  }

  return next;
}

function formatFuelDisplay(fuelFee, fuelVolume) {
  const feeText = String(fuelFee ?? "").trim();
  const volumeText = String(fuelVolume ?? "").trim();

  if (!feeText && !volumeText) {
    return "-";
  }

  return `${feeText ? `${feeText}元` : "-"}/${volumeText ? `${volumeText}L` : "-"}`;
}

function resolveCurrentUserName(user) {
  return readRequiredText(user?.fullName) || readRequiredText(user?.username);
}

function resolveRecordRegistrantName(record) {
  return (
    readRequiredText(record?.registrantName) ||
    readRequiredText(record?.driverName) ||
    readRequiredText(record?.registrantUsername) ||
    readRequiredText(record?.driverSignature)
  );
}

function getVehicleUsageStatus(vehicle) {
  if (
    vehicle?.status === "available" ||
    vehicle?.status === "可用" ||
    vehicle?.status === "空闲中"
  ) {
    return "空闲中";
  }

  if (
    vehicle?.status === "inUse" ||
    vehicle?.status === "idle" ||
    vehicle?.status === "闲置" ||
    vehicle?.status === "使用中" ||
    vehicle?.status === "在用"
  ) {
    return "使用中";
  }

  return "空闲中";
}

function buildRecordQueryString(filters, visibleRecordIds) {
  const params = new URLSearchParams();
  params.set("keyword", String(filters.keyword ?? ""));
  params.set("vehicleId", String(filters.vehicleId ?? ""));
  params.set("vehicleCode", String(filters.vehicleCode ?? ""));
  params.set("registrantUsername", String(filters.registrantUsername ?? ""));
  params.set("businessDate", String(filters.businessDate ?? ""));

  if (Array.isArray(visibleRecordIds)) {
    params.set("recordScope", "visible");
    params.set("recordIds", visibleRecordIds.join(","));
  }

  return params.toString();
}

function formatExportFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `用车记录-${year}年${month}月${day}日.pdf`;
}

function createBannerMessage(text, tone = "error") {
  const normalizedText = String(text ?? "").trim();

  if (!normalizedText) {
    return null;
  }

  return {
    text: normalizedText,
    tone
  };
}

function getFirstErrorMessage(errors) {
  return Object.values(errors).find(Boolean) ?? "";
}

function BannerMessage({ message, defaultTone = "error" }) {
  if (!message) {
    return null;
  }

  const text = typeof message === "string" ? message : message.text;
  const tone = typeof message === "string" ? defaultTone : message.tone ?? defaultTone;

  if (!text) {
    return null;
  }

  return <p className={`message banner-message banner-message-${tone}`}>{text}</p>;
}

function AppIcon({ name, className = "" }) {
  const classes = className ? `app-icon ${className}` : "app-icon";

  switch (name) {
    case "arrowLeft":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M14.5 5.5 8 12l6.5 6.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        </svg>
      );
    case "chevronRight":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M9.5 5.5 16 12l-6.5 6.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
          />
        </svg>
      );
    case "user":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <circle cx="12" cy="8.5" fill="none" r="3.5" stroke="currentColor" strokeWidth="2.2" />
          <path
            d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    case "users":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <circle cx="10" cy="8.5" fill="none" r="3.2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M4.5 18.5c1.4-2.8 3.8-4.2 6-4.2 2.1 0 4.4 1.2 5.8 3.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="M16.5 7a2.7 2.7 0 0 1 0 5.4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="M18.5 17.8c-.5-1.5-1.6-2.7-3.1-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "car":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M5 14.5V11c0-1.1.7-2.1 1.7-2.5L9 7h6l2.3 1.5c1 .4 1.7 1.4 1.7 2.5v3.5"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M4 14.5h16v2a1.5 1.5 0 0 1-1.5 1.5h-1.2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M6.7 18H5.5A1.5 1.5 0 0 1 4 16.5v-2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <circle cx="8" cy="15.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="15.8" r="1.6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "file":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M8 3.5h6l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M14 3.5V8h4"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M9 12h6M9 16h6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "lock":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <rect
            fill="none"
            height="9"
            rx="2.4"
            stroke="currentColor"
            strokeWidth="2"
            width="14"
            x="5"
            y="10"
          />
          <path
            d="M8 10V7.5A4 4 0 0 1 12 3.5a4 4 0 0 1 4 4V10"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "shield":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M12 3.5 18 6v5.6c0 3.4-2.4 6.5-6 7.9-3.6-1.4-6-4.5-6-7.9V6l6-2.5Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "download":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M12 5.5v8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
          <path
            d="m8.5 10.5 3.5 3.5 3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          />
          <path
            d="M6 18.5h12"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    case "logout":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M14 7.5h3.5v9H14"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M10.5 12h8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="m15.5 8.5 3.5 3.5-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M10 18.5H7A1.5 1.5 0 0 1 5.5 17V7A1.5 1.5 0 0 1 7 5.5h3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "warning":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M12 5 4.8 18a1 1 0 0 0 .9 1.5h12.6a1 1 0 0 0 .9-1.5L12 5Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M12 9v4.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <circle cx="12" cy="16.8" r="1" fill="currentColor" />
        </svg>
      );
    case "eye":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <circle cx="12" cy="12" fill="none" r="2.7" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "eyeOff":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="m3.5 3.5 17 17"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="M6.8 6.8A13.6 13.6 0 0 0 2.5 12s3.4 5.5 9.5 5.5c2 0 3.7-.6 5-1.4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path
            d="M10.1 6.7a9.9 9.9 0 0 1 1.9-.2c6.1 0 9.5 5.5 9.5 5.5a16 16 0 0 1-2.7 3.3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "plus":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="M12 5v14M5 12h14"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    case "close":
      return (
        <svg aria-hidden="true" className={classes} viewBox="0 0 24 24">
          <path
            d="m6 6 12 12M18 6 6 18"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </svg>
      );
    default:
      return null;
  }
}

function AssetIcon({ name, className = "" }) {
  const source = assetIcons[name];

  if (!source) {
    return null;
  }

  return <img alt="" aria-hidden="true" className={className ? `app-icon ${className}` : "app-icon"} src={source} />;
}

function BrandMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <AssetIcon name="vehicle" />
    </span>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  error = "",
  autoComplete,
  inputAriaLabel,
  toggleLabelPrefix,
  placeholder = "",
  leadingIcon = ""
}) {
  const [isVisible, setIsVisible] = useState(false);
  const inputLabel = inputAriaLabel ?? label;
  const toggleLabelBase = toggleLabelPrefix ?? label;

  return (
    <label className="field">
      <span>{label}</span>
      <div className={leadingIcon ? "password-input-row input-with-leading" : "password-input-row"}>
        {leadingIcon ? <AssetIcon name={leadingIcon} className="input-leading-icon" /> : null}
        <input
          aria-label={inputLabel}
          autoComplete={autoComplete}
          placeholder={placeholder}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
        />
        <button
          aria-label={`${isVisible ? "隐藏" : "显示"}${toggleLabelBase}`}
          className="ghost-button password-toggle"
          type="button"
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? <AppIcon name="eyeOff" /> : <AssetIcon name="eye" />}
        </button>
      </div>
      {error ? <small className="error">{error}</small> : null}
    </label>
  );
}

function SheetHeader({ title, eyebrow = "", onClose }) {
  return (
    <div className="sheet-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {onClose ? (
        <button
          aria-label={`关闭${title}`}
          className="icon-button"
          type="button"
          onClick={onClose}
        >
          <AssetIcon name="close" />
        </button>
      ) : null}
    </div>
  );
}

function BottomSheet({
  open,
  title,
  ariaLabel,
  onClose,
  children,
  className = "",
  bodyClassName = "",
  overlayClassName = ""
}) {
  if (!open) {
    return null;
  }

  return (
    <div className={`modal-overlay bottom-sheet-overlay ${overlayClassName}`.trim()} role="presentation">
      <section
        aria-label={ariaLabel ?? title}
        aria-modal="true"
        className={`bottom-sheet ${className}`.trim()}
        role="dialog"
      >
        <SheetHeader title={title} onClose={onClose} />
        <div className={`bottom-sheet-body ${bodyClassName}`.trim()}>{children}</div>
      </section>
    </div>
  );
}

function SignaturePreviewSheet({ open, title, imageSrc, onClose }) {
  if (!open || !imageSrc) {
    return null;
  }

  return (
    <BottomSheet open={open} title={title} ariaLabel={title} onClose={onClose}>
      <div className="signature-preview-sheet">
        <div className="signature-preview-sheet-frame">
          <img alt={title} className="signature-preview-sheet-image" src={imageSrc} />
        </div>
      </div>
    </BottomSheet>
  );
}

function SignatureCanvas({
  value,
  onChange,
  ariaLabel,
  className = "signature-pad",
  minWidth = 0,
  minHeight = 156,
  viewportWidth = 0,
  viewportHeight = 0
}) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);

  function safelyGetContext(canvas) {
    if (!canvas?.getContext) {
      return null;
    }

    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    if (isJsdomEnvironment()) {
      if (!value) {
        onChange(TEST_SIGNATURE_DATA_URL);
      }
      return;
    }

    const context = safelyGetContext(canvas);
    if (!context) {
      return;
    }

    function paintCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(viewportWidth || rect.width || minWidth, 1);
      const height = Math.max(viewportHeight || rect.height || minHeight, minHeight);

      if (width <= 0 || height <= 0) {
        return;
      }

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.8;
      context.strokeStyle = "#16336f";

      if (value) {
        const image = new Image();
        image.onload = () => {
          context.clearRect(0, 0, width, height);
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
        };
        image.src = value;
      }
    }

    paintCanvas();
  }, [minHeight, minWidth, onChange, value, viewportHeight, viewportWidth]);

  function getCanvasPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function saveSignature() {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const exportCanvas = document.createElement("canvas");
    const exportWidth = Math.max(Math.round(viewportWidth || rect.width), 1);
    const exportHeight = Math.max(Math.round(viewportHeight || rect.height), minHeight);
    const exportContext = exportCanvas.getContext("2d");

    if (!exportContext) {
      onChange(canvas.toDataURL("image/jpeg", 0.82));
      return;
    }

    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;
    exportContext.fillStyle = "#ffffff";
    exportContext.fillRect(0, 0, exportWidth, exportHeight);
    exportContext.drawImage(canvas, 0, 0, exportWidth, exportHeight);
    onChange(exportCanvas.toDataURL("image/jpeg", 0.82));
  }

  function handlePointerDown(event) {
    const canvas = canvasRef.current;
    const context = safelyGetContext(canvas);

    if (!canvas || !context) {
      return;
    }

    event.preventDefault();
    if (typeof canvas.setPointerCapture === "function") {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
    }

    const point = getCanvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    isDrawingRef.current = true;
  }

  function handlePointerMove(event) {
    if (!isDrawingRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const context = safelyGetContext(canvas);

    if (!canvas || !context) {
      return;
    }

    event.preventDefault();
    const point = getCanvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function handlePointerUp(event) {
    if (!isDrawingRef.current) {
      return;
    }

    event?.preventDefault?.();
    isDrawingRef.current = false;
    if (typeof canvasRef.current?.releasePointerCapture === "function" && event?.pointerId !== undefined) {
      try {
        canvasRef.current.releasePointerCapture(event.pointerId);
      } catch {}
    }
    saveSignature();
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label={ariaLabel}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
}

function SignatureEditorSheet({ open, value, onChange, currentName, onClose, onClear }) {
  const containerRef = useRef(null);
  const shellRef = useRef(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!open || isJsdomEnvironment()) {
      return;
    }

    const isMobileLikeDevice =
      window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth <= 720;

    if (!isMobileLikeDevice) {
      return;
    }

    let orientationLocked = false;

    async function enterImmersiveMode() {
      try {
        if (window.innerWidth < window.innerHeight && screen.orientation?.lock) {
          await screen.orientation.lock("landscape");
          orientationLocked = true;
        }
      } catch {}
    }

    enterImmersiveMode();

    return () => {
      if (orientationLocked && screen.orientation?.unlock) {
        try {
          screen.orientation.unlock();
        } catch {}
      }
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    function updateSurfaceSize() {
      const rect = shell.getBoundingClientRect();
      setSurfaceSize({
        width: Math.max(Math.round(rect.width), 0),
        height: Math.max(Math.round(rect.height), 0)
      });
    }

    updateSurfaceSize();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            updateSurfaceSize();
          })
        : null;

    resizeObserver?.observe(shell);
    window.addEventListener("resize", updateSurfaceSize);
    window.addEventListener("orientationchange", updateSurfaceSize);
    window.visualViewport?.addEventListener?.("resize", updateSurfaceSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateSurfaceSize);
      window.removeEventListener("orientationchange", updateSurfaceSize);
      window.visualViewport?.removeEventListener?.("resize", updateSurfaceSize);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay signature-editor-overlay" role="presentation">
      <section
        ref={containerRef}
        aria-label="全屏签字"
        aria-modal="true"
        className="signature-editor-dialog"
        role="dialog"
      >
        <header className="signature-editor-header">
          <div className="signature-editor-title-wrap">
            <h2>全屏签字</h2>
            <p>签字人：{currentName || "-"}</p>
          </div>
          <button aria-label="关闭全屏签字" className="icon-button signature-editor-close" type="button" onClick={onClose}>
            <AssetIcon name="close" />
          </button>
        </header>
        <div className="signature-editor-sheet">
          <div className="signature-editor-immersive-tip">可横屏书写，签字区域已铺满整个可用屏幕。</div>
          <div ref={shellRef} className="signature-editor-shell">
            <SignatureCanvas
              ariaLabel="全屏驾驶员手写签字"
              className="signature-pad signature-pad-fullscreen"
              minHeight={360}
              onChange={onChange}
              value={value}
              viewportHeight={surfaceSize.height}
              viewportWidth={surfaceSize.width}
            />
          </div>
          <div className="signature-editor-actions">
            <button className="ghost-button signature-reset-button" type="button" onClick={onClear}>
              清空重签
            </button>
            <button className="primary-button" type="button" onClick={onClose}>
              完成书写
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SignatureField({ value, onChange, error = "", currentName }) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  function handleClearSignature() {
    onChange("");
  }

  return (
    <>
      <div className="field field-span-2 signature-field">
        <div className="signature-field-header">
          <div>
            <span>驾驶员签字</span>
            <small className="signature-field-caption">签字人：{currentName || "-"}</small>
          </div>
          <button
            className="ghost-button signature-fullscreen-button"
            type="button"
            onClick={() => setIsFullscreenOpen(true)}
          >
            全屏书写
          </button>
        </div>
        <div className="signature-pad-shell">
          <SignatureCanvas ariaLabel="驾驶员手写签字" onChange={onChange} value={value} />
        </div>
        <div className="signature-field-actions">
          <div className="signature-action-buttons">
            <button
              className="ghost-button signature-fullscreen-button signature-fullscreen-button-mobile"
              type="button"
              onClick={() => setIsFullscreenOpen(true)}
            >
              全屏书写
            </button>
            <button className="ghost-button signature-reset-button" type="button" onClick={handleClearSignature}>
              清空重签
            </button>
          </div>
        </div>
        {error ? <small className="error">{error}</small> : null}
      </div>
      <SignatureEditorSheet
        currentName={currentName}
        onChange={onChange}
        onClear={handleClearSignature}
        onClose={() => setIsFullscreenOpen(false)}
        open={isFullscreenOpen}
        value={value}
      />
    </>
  );
}

function ConfirmDeleteModal({
  open,
  title,
  body,
  ariaLabel,
  confirmLabel = "确认删除",
  onCancel,
  onConfirm
}) {
  if (!open) {
    return null;
  }

  return (
    <BottomSheet open={open} title={title} ariaLabel={ariaLabel} onClose={onCancel}>
        <div className="confirm-modal-body">
          <div className="confirm-modal-icon">
            <AppIcon name="warning" />
          </div>
          <p>{body}</p>
        </div>
        <div className="confirm-modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
    </BottomSheet>
  );
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
  const [loginMessage, setLoginMessage] = useState(null);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [passwordMessage, setPasswordMessage] = useState(null);
  const [passwordErrors, setPasswordErrors] = useState({});
  const [view, setView] = useState(employeeRegistryView);
  const [managedUsers, setManagedUsers] = useState([]);
  const [managedRecords, setManagedRecords] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [registryForm, setRegistryForm] = useState(() => createEmptyRegistryForm());
  const [registryMessage, setRegistryMessage] = useState(null);
  const [registryErrors, setRegistryErrors] = useState({});
  const [userManagementMessage, setUserManagementMessage] = useState(null);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserErrors, setNewUserErrors] = useState({});
  const [newUserForm, setNewUserForm] = useState({
    fullName: "",
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
    brandModel: "",
    status: "available"
  });
  const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState(null);
  const [pendingVehicleStatusChange, setPendingVehicleStatusChange] = useState(null);
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [expandedRecordId, setExpandedRecordId] = useState("");
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [previewSignatureRecord, setPreviewSignatureRecord] = useState(null);
  const [recordFilters, setRecordFilters] = useState({
    keyword: "",
    vehicleId: "",
    vehicleCode: "",
    registrantUsername: "",
    businessDate: ""
  });
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
  const selectedVehicleUsageStatus = getVehicleUsageStatus(selectedVehicle);

  useEffect(() => {
    if (!user || user.role === "admin" || view !== employeeRegistryView || !selectedVehicleId) {
      setRegistryForm(createRegistryFormWithMileage("", { driverName: resolveCurrentUserName(user) }));
      return undefined;
    }

    let isCurrent = true;

    async function loadLatestMileage() {
      setRegistryMessage(null);
      setRegistryForm(createRegistryFormWithMileage("", { driverName: resolveCurrentUserName(user) }));

      const response = await fetch(`/api/vehicles/${selectedVehicleId}/latest-mileage`, {
        credentials: "include"
      });

      if (!isCurrent) {
        return;
      }

      if (!response.ok) {
        setRegistryMessage(createBannerMessage(await readApiMessage(response)));
        setRegistryForm(createRegistryFormWithMileage("", { driverName: resolveCurrentUserName(user) }));
        return;
      }

      const body = await response.json();
      setRegistryForm(createRegistryFormWithMileage(body.startMileage, {
        driverName: resolveCurrentUserName(user)
      }));
    }

    loadLatestMileage();

    return () => {
      isCurrent = false;
    };
  }, [user, selectedVehicleId]);

  function updateLoginField(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
    setLoginErrors((current) => ({ ...current, [field]: "" }));
    setLoginMessage(null);
  }

  function closeInlinePanels() {
    setIsPasswordDialogOpen(false);
    setIsAddUserOpen(false);
    setPendingDeleteUser(null);
    setResetUser(null);
    setIsAddVehicleOpen(false);
    setPendingDeleteVehicle(null);
    setPendingVehicleStatusChange(null);
    setPendingDeleteRecord(null);
    setExpandedRecordId("");
    setIsBulkDeleteOpen(false);
    setPreviewSignatureRecord(null);
  }

  function resetPasswordModuleState() {
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordErrors({});
    setPasswordMessage(null);
  }

  function resetAdminModuleState() {
    closeInlinePanels();
    setUserManagementMessage(null);
    resetPasswordModuleState();
  }

  function updatePasswordField(field, value) {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: "" }));
    setPasswordMessage(null);
  }

  function updateNewUserField(field, value) {
    setNewUserForm((current) => ({ ...current, [field]: value }));
    setNewUserErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage(null);
  }

  function updateResetPasswordField(field, value) {
    setResetPasswordForm((current) => ({ ...current, [field]: value }));
    setResetPasswordErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage(null);
  }

  function updateVehicleField(field, value) {
    setVehicleForm((current) => ({ ...current, [field]: value }));
    setVehicleErrors((current) => ({ ...current, [field]: "" }));
    setUserManagementMessage(null);
  }

  function updateRegistryField(field, value) {
    const normalizedValue =
      field === "fuelFee" || field === "fuelVolume" ? normalizeDecimalInput(value) : value;

    let nextFormSnapshot = null;

    setRegistryForm((current) => {
      const next = {
        ...current,
        [field]: normalizedValue
      };

      if (field === "startMileage") {
        const currentStartMileage = String(current.startMileage ?? "").trim();
        const currentEndMileage = String(current.endMileage ?? "").trim();
        const shouldSyncEndMileage = !currentEndMileage || currentEndMileage === currentStartMileage;

        if (shouldSyncEndMileage) {
          next.endMileage = normalizedValue;
        }
      }

      if (field === "startMileage" || field === "endMileage") {
        next.distance = calculateDistance(next.startMileage, next.endMileage);
      }

      nextFormSnapshot = next;
      return next;
    });
    setRegistryErrors((current) => {
      const nextErrors = {
        ...current,
        [field]: ""
      };
      const constraintErrors = getRegistryConstraintErrors(nextFormSnapshot ?? { [field]: normalizedValue });

      if (constraintErrors[field]) {
        nextErrors[field] = constraintErrors[field];
      }

      return nextErrors;
    });
    setRegistryMessage(null);
  }

  function updateRecordFilter(field, value) {
    setSelectedRecordIds([]);
    setPendingDeleteRecord(null);
    setExpandedRecordId("");
    setIsBulkDeleteOpen(false);
    setRecordFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function clearRecordFilters() {
    setSelectedRecordIds([]);
    setPendingDeleteRecord(null);
    setExpandedRecordId("");
    setIsBulkDeleteOpen(false);
    setRecordFilters({
      keyword: "",
      vehicleId: "",
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
    const queryString = buildRecordQueryString(
      recordFilters,
      filteredManagedRecords.map((record) => record.id)
    );
    const response = await fetch(`/api/records/export?${queryString}`, {
      credentials: "include"
    });

    if (!response.ok) {
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = formatExportFileName();
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setUserManagementMessage(createBannerMessage("PDF 已导出", "success"));
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
    setLoginMessage(null);

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
      setLoginMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json();
    const nextUser = body.user;

    setUser(nextUser);
    resetAdminModuleState();
    setLoginForm({ username: "", password: "" });
    setRegistryMessage(null);
    setRegistryErrors({});

    if (nextUser.role === "admin") {
      setView(adminHomeView);
      setVehicles([]);
      setSelectedVehicleId("");
      setRegistryForm(createEmptyRegistryForm({ driverName: resolveCurrentUserName(nextUser) }));
      return;
    }

    setView(employeeRegistryView);
    setRegistryForm(createEmptyRegistryForm({ driverName: resolveCurrentUserName(nextUser) }));
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
    setRegistryMessage(null);
    setLoginMessage(null);
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
      setPasswordMessage(createBannerMessage("两次新密码不一致"));
      return;
    }

    if (passwordForm.newPassword === passwordForm.currentPassword) {
      setPasswordMessage(createBannerMessage("新密码不能与当前密码相同"));
      return;
    }

    if (!isComplexPassword(passwordForm.newPassword)) {
      setPasswordMessage(createBannerMessage("新密码需至少 6 位且同时包含字母和数字"));
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
      setPasswordMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const message = await readApiMessage(response);
    setUser(null);
    setView(employeeRegistryView);
    resetAdminModuleState();
    setLoginMessage(createBannerMessage(message, "success"));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json();
    setManagedRecords(normalizeRecords(body));
    clearRecordFilters();
    setView(adminRecordsView);
  }

  function openAdminPasswordModule() {
    resetAdminModuleState();
    setIsPasswordDialogOpen(true);
  }

  async function handleCreateUser(event) {
    event.preventDefault();

    const errors = {};

    if (!newUserForm.username.trim()) {
      errors.username = "新账号必填";
    }
    if (!newUserForm.fullName.trim()) {
      errors.fullName = "用户姓名必填";
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json();
    setManagedUsers((current) => [...current, body.user]);
    setNewUserForm({ fullName: "", username: "", password: "", role: "employee" });
    setNewUserErrors({});
    setIsAddUserOpen(false);
    setUserManagementMessage(createBannerMessage("用户已新增", "success"));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json();
    setVehicles((current) =>
      [...current, body.vehicle].sort((left, right) => left.vehicleCode.localeCompare(right.vehicleCode))
    );
    setSelectedVehicleId((current) => current || body.vehicle.id);
    setVehicleForm({ vehicleCode: "", plateNumber: "", brandModel: "", status: "available" });
    setVehicleErrors({});
    setIsAddVehicleOpen(false);
    setUserManagementMessage(createBannerMessage("车辆已新增，默认状态为空闲中", "success"));
  }

  async function confirmVehicleStatusChange() {
    if (!pendingVehicleStatusChange) {
      return;
    }

    const { vehicleId, nextStatus } = pendingVehicleStatusChange;
    const response = await fetch(`/api/vehicles/${vehicleId}/status`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!response.ok) {
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json();
    setVehicles((current) =>
      current.map((vehicle) => (vehicle.id === vehicleId ? body.vehicle : vehicle))
    );
    setPendingVehicleStatusChange(null);
    setUserManagementMessage(
      createBannerMessage(nextStatus === "inUse" ? "车辆已设为使用中" : "车辆已设为空闲中", "success")
    );
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    setManagedUsers((current) =>
      current.filter((managedUser) => managedUser.id !== pendingDeleteUser.id)
    );
    setPendingDeleteUser(null);
    setUserManagementMessage(createBannerMessage("用户已删除", "success"));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
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
    setUserManagementMessage(createBannerMessage("车辆已删除", "success"));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    setManagedRecords((current) => current.filter((record) => record.id !== pendingDeleteRecord.id));
    setPendingDeleteRecord(null);
    setExpandedRecordId((current) => (current === pendingDeleteRecord.id ? "" : current));
    setUserManagementMessage(createBannerMessage("记录已删除", "success"));

    if (deletedVehicleId === selectedVehicleId) {
      await refreshSelectedVehicleMileage();
    }
  }

  async function confirmBatchDeleteRecords() {
    if (selectedRecordIds.length === 0) {
      setUserManagementMessage(createBannerMessage("请选择至少一条记录"));
      return;
    }

    const response = await fetch("/api/records/batch-delete", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ids: selectedRecordIds })
    });

    if (!response.ok) {
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    const body = await response.json().catch(() => ({}));
    setManagedRecords((current) =>
      current.filter((record) => !selectedRecordIds.includes(record.id))
    );
    setExpandedRecordId((current) => (selectedRecordIds.includes(current) ? "" : current));
    setSelectedRecordIds([]);
    setIsBulkDeleteOpen(false);
    setUserManagementMessage(createBannerMessage(body.message ?? "记录已批量删除", "success"));
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
      setUserManagementMessage(createBannerMessage("两次新密码不一致"));
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
      setUserManagementMessage(createBannerMessage(await readApiMessage(response)));
      return;
    }

    setResetUser(null);
    setResetPasswordErrors({});
    setResetPasswordForm({ newPassword: "", confirmPassword: "" });
    setUserManagementMessage(createBannerMessage("密码已重置", "success"));
  }

  async function handleRegistrySubmit(event) {
    event.preventDefault();

    const errors = {
      ...getRegistryConstraintErrors(registryForm)
    };

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
    const driverName = readRequiredText(registryForm.driverName);
    const driverSignatureImage = readRequiredText(registryForm.driverSignatureImage);
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
    if (!driverName) {
      errors.driverSignature = "驾驶员姓名不能为空";
    }
    if (!driverSignatureImage) {
      errors.driverSignature = "驾驶员签字必填";
    }

    if (Object.keys(errors).length > 0) {
      setRegistryErrors(errors);
      setRegistryMessage(createBannerMessage("提交失败，请先按页面提示修正后再提交"));
      return;
    }

    if (endMileage < startMileage) {
      setRegistryErrors((current) => ({
        ...current,
        endMileage: "终点公里不能小于起步公里"
      }));
      setRegistryMessage(createBannerMessage("终点公里不能小于起步公里"));
      return;
    }

    if (isReturnEarlierThanDeparture(registryForm.departureTime, registryForm.returnTime)) {
      setRegistryErrors((current) => ({
        ...current,
        returnTime: "还车时间不能小于出车时间"
      }));
      setRegistryMessage(createBannerMessage("还车时间不能小于出车时间"));
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
        driverName,
        driverSignatureImage,
        remark: registryForm.remark.trim()
      })
    });

    if (!response.ok) {
      const responseCopy = typeof response?.clone === "function" ? response.clone() : response;
      const body = await response.json().catch(() => ({}));
      if (body.fieldErrors && typeof body.fieldErrors === "object") {
        setRegistryErrors((current) => ({
          ...current,
          ...body.fieldErrors
        }));
      }
      setRegistryMessage(createBannerMessage(body.message ?? (await readApiMessage(responseCopy))));
      return;
    }

    const body = await response.json().catch(() => ({}));
    const nextStartMileage =
      body.record?.endMileage === null || body.record?.endMileage === undefined
        ? String(endMileage)
        : String(body.record.endMileage);

    setRegistryMessage(createBannerMessage(body.message ?? "登记已提交", "success"));
    setRegistryErrors({});
    setRegistryForm(
      createRegistryFormWithMileage(nextStartMileage, {
        driverName: resolveCurrentUserName(user)
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
          record.brandModel,
          resolveRecordRegistrantName(record),
          record.driverSignature,
          record.remark ?? ""
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      : true;

    const matchesVehicle = recordFilters.vehicleId
      ? record.vehicleId === recordFilters.vehicleId
      : recordFilters.vehicleCode
        ? record.vehicleCode === recordFilters.vehicleCode
        : true;
    const matchesUser = recordFilters.registrantUsername
      ? resolveRecordRegistrantName(record) === recordFilters.registrantUsername
      : true;
    const matchesDate = recordFilters.businessDate
      ? record.businessDate === recordFilters.businessDate
      : true;

    return matchesKeyword && matchesVehicle && matchesUser && matchesDate;
  });
  const managedRecordVehicleOptions = Array.from(
    managedRecords
      .reduce((options, record) => {
        if (!options.has(record.vehicleId)) {
          options.set(record.vehicleId, {
            vehicleId: record.vehicleId,
            vehicleCode: record.vehicleCode,
            plateNumber: record.plateNumber,
            brandModel: record.brandModel
          });
        }

        return options;
      }, new Map())
      .values()
  );
  const areAllFilteredRecordsSelected =
    filteredManagedRecords.length > 0 &&
    filteredManagedRecords.every((record) => selectedRecordIds.includes(record.id));
  const deleteModalConfig = pendingDeleteUser
    ? {
        title: "确认删除",
        ariaLabel: "删除用户确认",
        body: `确认删除账号「${pendingDeleteUser.username}」？此操作不可撤销。`,
        onCancel: () => setPendingDeleteUser(null),
        onConfirm: confirmDeleteUser
      }
    : pendingDeleteVehicle
      ? {
          title: "确认删除",
          ariaLabel: "删除车辆确认",
          body: `确认删除车辆「${pendingDeleteVehicle.plateNumber}-${pendingDeleteVehicle.brandModel}」？此操作不可撤销。`,
          onCancel: () => setPendingDeleteVehicle(null),
          onConfirm: confirmDeleteVehicle
        }
      : pendingDeleteRecord
        ? {
            title: "确认删除",
            ariaLabel: "删除记录确认",
            body: `确认删除记录「${summarizeRecord(pendingDeleteRecord)}」？此操作不可撤销。`,
            onCancel: () => setPendingDeleteRecord(null),
            onConfirm: confirmDeleteRecord
          }
        : isBulkDeleteOpen
          ? {
              title: "确认删除",
              ariaLabel: "批量删除记录确认",
              body: `确认删除已选 ${selectedRecordIds.length} 条记录？此操作不可撤销。`,
              onCancel: () => setIsBulkDeleteOpen(false),
              onConfirm: confirmBatchDeleteRecords
            }
          : pendingVehicleStatusChange
            ? {
                title: "确认操作",
                ariaLabel: "车辆状态切换确认",
                body: `确认将车辆「${
                  pendingVehicleStatusChange.brandModel
                    ? `${pendingVehicleStatusChange.plateNumber}-${pendingVehicleStatusChange.brandModel}`
                    : pendingVehicleStatusChange.plateNumber
                }」设为${
                  pendingVehicleStatusChange.nextStatus === "inUse" ? "使用中" : "空闲中"
                }？`,
                confirmLabel: "确认操作",
                onCancel: () => setPendingVehicleStatusChange(null),
                onConfirm: confirmVehicleStatusChange
              }
          : null;

  if (!user) {
    return (
      <main className="shell shell-login">
        <section className="auth-layout">
          <header className="page-hero auth-hero">
            <div className="brand-row brand-row-centered">
              <BrandMark />
            </div>
            <h1>公务用车管理平台</h1>
            <p className="hero-badge">登记专用</p>
            <p className="hero-subtitle">请使用账号密码登录，进入用车管理工作台</p>
          </header>

          <section className="page-surface auth-surface">
            <form className="sheet-card auth-card form" onSubmit={handleLogin} noValidate>
              <SheetHeader title="账号登录" />

              <label className="field">
                <span>账号</span>
                <div className="input-with-leading">
                  <AssetIcon name="account" className="input-leading-icon" />
                  <input
                    autoComplete="username"
                    placeholder="请输入账号"
                    value={loginForm.username}
                    onChange={(event) => updateLoginField("username", event.target.value)}
                  />
                </div>
                {loginErrors.username ? <small className="error">{loginErrors.username}</small> : null}
              </label>

              <PasswordField
                autoComplete="current-password"
                error={loginErrors.password}
                label="密码"
                leadingIcon="password"
                placeholder="请输入密码"
                value={loginForm.password}
                onChange={(event) => updateLoginField("password", event.target.value)}
              />

              <BannerMessage message={loginMessage} />

              <button className="primary-button primary-button-large" type="submit">
                登录
              </button>
            </form>

            <div className="notice-card">
              <AppIcon name="shield" className="notice-icon" />
              <p>本系统为内部专用，账号信息请妥善保管，禁止转借他人使用</p>
            </div>

            <p className="copyright">© 2026 公务用车管理平台 · 版权所有</p>
          </section>
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className="shell">
        <section className="app-shell">
          <header className="page-hero employee-hero">
            <div className="brand-row">
              <span aria-hidden="true" className="brand-mark">
                <AssetIcon name="employeeHeaderCar" />
              </span>
              <span className="brand-title">公务用车管理平台</span>
            </div>
            <h1>公务用车使用登记</h1>
            <p className="hero-subtitle">填写当次用车信息后提交，系统会按车辆独立维护默认起步公里。</p>
          </header>

          <div className="page-surface">
            <section className="summary-card identity-card" aria-label="当前登录信息">
              <div className="summary-leading">
                <span className="summary-icon">
                  <AppIcon name="user" />
                </span>
                <div>
                  <p>当前用户：{resolveCurrentUserName(user)}</p>
                  <p>登录账号：{user.username}</p>
                  <p>当前角色：{roleLabels[user.role] ?? user.role}</p>
                </div>
              </div>
            </section>

            <form
              className="sheet-card form registry-form"
              id="employee-registry-form"
              onSubmit={handleRegistrySubmit}
              noValidate
            >
              <label className="field registry-vehicle-field">
                <span>车辆</span>
                <select
                  aria-label="车辆"
                  value={selectedVehicleId}
                  onChange={(event) => {
                    setSelectedVehicleId(event.target.value);
                    setRegistryMessage(null);
                  }}
                >
                  {vehicles.length === 0 ? <option value="">暂无车辆</option> : null}
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {formatVehicleDisplay(vehicle)}
                    </option>
                  ))}
                </select>
                {registryErrors.vehicleId ? <small className="error">{registryErrors.vehicleId}</small> : null}
                {selectedVehicle && selectedVehicleUsageStatus === "使用中" ? (
                  <small className="field-hint">当前车辆为使用中状态，请确认后登记</small>
                ) : null}
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
                    placeholder="用车事由"
                    value={registryForm.reason}
                    onChange={(event) => updateRegistryField("reason", event.target.value)}
                  />
                  {registryErrors.reason ? <small className="error">{registryErrors.reason}</small> : null}
                </label>
                <label className="field field-span-2">
                  <span>目的地及行车路线</span>
                  <input
                    aria-label="目的地及行车路线"
                    placeholder="请填写目的地及行车路线"
                    value={registryForm.route}
                    onChange={(event) => updateRegistryField("route", event.target.value)}
                  />
                  {registryErrors.route ? <small className="error">{registryErrors.route}</small> : null}
                </label>
                <label className="field field-with-unit">
                  <span>起步公里读数</span>
                  <input
                    aria-label="起步公里读数"
                    inputMode="numeric"
                    placeholder="km"
                    type="number"
                    min="0"
                    value={registryForm.startMileage}
                    onChange={(event) => updateRegistryField("startMileage", event.target.value)}
                  />
                  {registryErrors.startMileage ? (
                    <small className="error">{registryErrors.startMileage}</small>
                  ) : null}
                </label>
                <label className="field field-with-unit">
                  <span>终点公里读数</span>
                  <input
                    aria-label="终点公里读数"
                    inputMode="numeric"
                    placeholder="km"
                    type="number"
                    min="0"
                    value={registryForm.endMileage}
                    onFocus={(event) => {
                      if (
                        String(registryForm.endMileage ?? "").trim() &&
                        String(registryForm.endMileage ?? "").trim() ===
                          String(registryForm.startMileage ?? "").trim()
                      ) {
                        event.target.select();
                      }
                    }}
                    onChange={(event) => updateRegistryField("endMileage", event.target.value)}
                  />
                  {registryErrors.endMileage ? (
                    <small className="error">{registryErrors.endMileage}</small>
                  ) : null}
                </label>
                <label className="field field-with-unit">
                  <span>行车公里数</span>
                  <input
                    aria-label="行车公里数"
                    placeholder="km"
                    readOnly
                    type="number"
                    value={registryForm.distance}
                  />
                </label>
                <SignatureField
                  currentName={registryForm.driverName}
                  error={registryErrors.driverSignature}
                  value={registryForm.driverSignatureImage}
                  onChange={(nextValue) => updateRegistryField("driverSignatureImage", nextValue)}
                />
                <label className="field">
                  <span>加油费用（元）</span>
                  <input
                    aria-label="加油费用（元）"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    placeholder="0.00"
                    step="any"
                    value={registryForm.fuelFee}
                    onChange={(event) => updateRegistryField("fuelFee", event.target.value)}
                  />
                  {registryErrors.fuelFee ? <small className="error">{registryErrors.fuelFee}</small> : null}
                </label>
                <label className="field">
                  <span>加油数量（升）</span>
                  <input
                    aria-label="加油数量（升）"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    placeholder="0.0"
                    step="any"
                    value={registryForm.fuelVolume}
                    onChange={(event) => updateRegistryField("fuelVolume", event.target.value)}
                  />
                  {registryErrors.fuelVolume ? <small className="error">{registryErrors.fuelVolume}</small> : null}
                </label>
                <label className="field field-span-2">
                  <span>备注</span>
                  <input
                    aria-label="备注"
                    placeholder="选填"
                    value={registryForm.remark}
                    onChange={(event) => updateRegistryField("remark", event.target.value)}
                  />
                  {registryErrors.remark ? <small className="error">{registryErrors.remark}</small> : null}
                </label>
              </div>

              <BannerMessage message={registryMessage} />

              <div className="action-row action-row-split registry-actions">
                <button className="primary-button primary-button-large" type="submit">
                  提交登记
                </button>
                <button
                  className="secondary-button secondary-button-large"
                  type="button"
                  onClick={() => {
                    closeInlinePanels();
                    setPasswordMessage(null);
                    setPasswordErrors({});
                    setIsPasswordDialogOpen(true);
                  }}
                >
                  修改密码
                </button>
                <button className="ghost-button ghost-button-large" type="button" onClick={handleLogout}>
                  <AssetIcon name="employeeLogout" />
                  <span>退出</span>
                </button>
              </div>
            </form>

          </div>
        </section>
        <BottomSheet
          open={isPasswordDialogOpen}
          title="修改密码"
          onClose={() => {
            setIsPasswordDialogOpen(false);
            setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
            setPasswordErrors({});
            setPasswordMessage(null);
          }}
        >
          <form className="bottom-sheet-form form" onSubmit={handleChangePassword} noValidate>
            <PasswordField
              autoComplete="current-password"
              error={passwordErrors.currentPassword}
              label="当前密码"
              placeholder="请输入当前密码"
              value={passwordForm.currentPassword}
              onChange={(event) => updatePasswordField("currentPassword", event.target.value)}
            />
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors.newPassword}
              label="新密码"
              placeholder="请输入新密码"
              value={passwordForm.newPassword}
              onChange={(event) => updatePasswordField("newPassword", event.target.value)}
            />
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors.confirmPassword}
              label="确认新密码"
              placeholder="请再次输入新密码"
              value={passwordForm.confirmPassword}
              onChange={(event) => updatePasswordField("confirmPassword", event.target.value)}
            />

            <BannerMessage message={passwordMessage} />

            <div className="action-row sheet-actions sheet-actions-primary-only">
              <button className="primary-button primary-button-large" type="submit">
                提交修改
              </button>
            </div>
          </form>
        </BottomSheet>
        <ConfirmDeleteModal
          {...(deleteModalConfig ?? {})}
          open={Boolean(deleteModalConfig)}
          title={deleteModalConfig?.title ?? "确认删除"}
        />
      </main>
    );
  }

  return (
    <main className="shell">
      {view === adminHomeView ? (
        <section className="app-shell">
          <header className="page-hero admin-hero">
            <div className="brand-row admin-home-brand-row">
              <span aria-hidden="true" className="admin-home-brand-mark">
                <AssetIcon name="adminHeaderCar" />
              </span>
              <span className="brand-title">公务用车管理平台</span>
            </div>
            <h1>管理员工作台</h1>
            <p className="admin-home-subtitle">请选择要进入的管理模块</p>
          </header>

          <div className="page-surface">
            <section className="summary-card summary-card-with-action" aria-label="当前登录信息">
              <div className="summary-leading summary-leading-bar">
                <div>
                  <p>当前用户：{resolveCurrentUserName(user)}</p>
                  <p>登录账号：{user.username}</p>
                  <p>当前角色：{roleLabels[user.role] ?? user.role}</p>
                </div>
              </div>
              <button className="ghost-button ghost-button-danger" type="button" onClick={handleLogout}>
                退出登录
              </button>
            </section>

            <BannerMessage message={userManagementMessage} />

            <section className="nav-card-list" aria-label="管理员导航">
              <button className="module-nav-card" type="button" onClick={openAdminUsers}>
                <span className="module-nav-icon">
                  <AssetIcon name="adminUsers" />
                </span>
                <span className="module-nav-copy">
                  <strong>用户账号管理</strong>
                </span>
                <AppIcon name="chevronRight" className="module-nav-chevron" />
              </button>
              <button className="module-nav-card" type="button" onClick={openAdminVehicles}>
                <span className="module-nav-icon">
                  <AssetIcon name="adminVehicles" />
                </span>
                <span className="module-nav-copy">
                  <strong>公车档案管理</strong>
                </span>
                <AppIcon name="chevronRight" className="module-nav-chevron" />
              </button>
              <button className="module-nav-card" type="button" onClick={openAdminRecords}>
                <span className="module-nav-icon">
                  <AssetIcon name="adminRecords" />
                </span>
                <span className="module-nav-copy">
                  <strong>用车记录管理</strong>
                </span>
                <AppIcon name="chevronRight" className="module-nav-chevron" />
              </button>
              <button className="module-nav-card" type="button" onClick={openAdminPasswordModule}>
                <span className="module-nav-icon">
                  <AssetIcon name="adminPassword" />
                </span>
                <span className="module-nav-copy">
                  <strong>修改密码</strong>
                </span>
                <AppIcon name="chevronRight" className="module-nav-chevron" />
              </button>
            </section>
          </div>
        </section>
      ) : null}

      {view !== adminHomeView ? (
        <section className="module-shell">
          <div className="module-topbar">
            <button
              aria-label="返回管理首页"
              className="icon-button module-back-button"
              type="button"
              onClick={openAdminHome}
            >
              <AssetIcon name="navBack" />
            </button>
            <div className="module-topbar-copy">
              <p className="eyebrow">管理模块</p>
              <h1>
                {view === adminUsersView
                  ? "用户账号管理"
                  : view === adminVehiclesView
                    ? "公车档案管理"
                    : view === adminRecordsView
                      ? "用车记录管理"
                      : "修改密码"}
              </h1>
            </div>
            {view === adminUsersView ? (
              <button
                className="primary-button module-topbar-action"
                type="button"
                onClick={() => {
                  closeInlinePanels();
                  setNewUserErrors({});
                  setUserManagementMessage(null);
                  setIsAddUserOpen(true);
                }}
              >
                <AssetIcon name="navPlus" />
                <span>新增用户</span>
              </button>
            ) : null}
            {view === adminVehiclesView ? (
              <button
                className="primary-button module-topbar-action"
                type="button"
                onClick={() => {
                  closeInlinePanels();
                  setVehicleErrors({});
                  setUserManagementMessage(null);
                  setIsAddVehicleOpen(true);
                }}
              >
                <AssetIcon name="navPlus" />
                <span>新增车辆</span>
              </button>
            ) : null}
            {view === adminRecordsView ? (
              <button
                aria-label="导出 PDF"
                className="danger-button module-topbar-action"
                type="button"
                onClick={handleExportRecords}
              >
                <AssetIcon name="export" />
                <span>导出</span>
              </button>
            ) : null}
          </div>

          <div className="module-surface">
            {view === adminUsersView ? (
              <section className="management-panel" aria-label="用户账号管理">
                <p className="module-count">共 {managedUsers.length} 个账号</p>
                <BannerMessage message={userManagementMessage} />

                <div className="entity-list">
                  {managedUsers.length === 0 ? <p className="empty-state">暂无用户</p> : null}
                  {managedUsers.map((managedUser) => {
                    const canResetPassword =
                      managedUser.username !== user.username &&
                      (managedUser.role === "employee" || user.username === "admin");
                    const canDeleteUser =
                      !managedUser.isBuiltinAdmin &&
                      !(managedUser.username === user.username && user.username !== "admin");

                    return (
                      <article className="entity-card" key={managedUser.id}>
                        <div className="entity-main">
                          <span className={`entity-avatar ${managedUser.isBuiltinAdmin ? "" : "entity-avatar-soft"}`}>
                            <AppIcon name="user" />
                          </span>
                          <div className="entity-copy">
                            <div className="entity-title-row">
                              <strong>{managedUser.fullName || managedUser.username}</strong>
                              {managedUser.isBuiltinAdmin ? <span className="status-pill">内置</span> : null}
                            </div>
                            <p>账号：{managedUser.username}</p>
                            <p>{roleLabels[managedUser.role] ?? managedUser.role}</p>
                            {!canDeleteUser && managedUser.id === user.id && user.username !== "admin" ? (
                              <small>当前账号不可自删</small>
                            ) : null}
                          </div>
                        </div>
                        <div className="action-row entity-actions">
                          {canResetPassword ? (
                            <button
                              aria-label={`重置密码 ${managedUser.username}`}
                              className="secondary-button"
                              type="button"
                              onClick={() => {
                                closeInlinePanels();
                                setResetPasswordErrors({});
                                setResetPasswordForm({ newPassword: "", confirmPassword: "" });
                                setUserManagementMessage(null);
                                setResetUser(managedUser);
                              }}
                            >
                              重置密码
                            </button>
                          ) : null}
                          {!managedUser.isBuiltinAdmin ||
                          (managedUser.username === user.username && user.username !== "admin") ? (
                            <button
                              aria-label={`删除 ${managedUser.username}`}
                              className="ghost-button ghost-button-danger"
                              type="button"
                              onClick={() => {
                                if (managedUser.username === user.username && user.username !== "admin") {
                                  setUserManagementMessage(createBannerMessage("不能删除当前登录管理员账号"));
                                  return;
                                }

                                closeInlinePanels();
                                setUserManagementMessage(null);
                                setPendingDeleteUser(managedUser);
                              }}
                            >
                              删除
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

              </section>
            ) : null}

            {view === adminVehiclesView ? (
              <section className="management-panel" aria-label="公车档案管理">
                <p className="module-count">共 {vehicles.length} 辆车辆</p>
                <BannerMessage message={userManagementMessage} />

                <div className="entity-list">
                  {vehicles.length === 0 ? <p className="empty-state">暂无车辆</p> : null}
                  {vehicles.map((vehicle) => {
                    const usageStatus = getVehicleUsageStatus(vehicle);

                    return (
                      <article className="entity-card vehicle-card" key={vehicle.id}>
                        <div className="entity-main vehicle-card-main">
                          <span className="vehicle-card-icon">
                            <AssetIcon name="adminVehicleList" />
                          </span>
                          <div className="entity-copy vehicle-card-copy">
                            <div className="entity-title-row vehicle-title-row">
                              <strong>{vehicle.plateNumber}</strong>
                              <span
                                className={`vehicle-status-pill ${
                                  usageStatus === "使用中" ? "vehicle-status-idle" : "vehicle-status-active"
                                }`}
                              >
                                {usageStatus}
                              </span>
                            </div>
                            <p>{vehicle.brandModel}</p>
                          </div>
                        </div>
                        <div className="action-row entity-actions">
                          <button
                            aria-label={`设为${usageStatus === "使用中" ? "空闲中" : "使用中"} ${vehicle.vehicleCode}`}
                            className="secondary-button vehicle-status-action"
                            type="button"
                            onClick={() => {
                              closeInlinePanels();
                              setUserManagementMessage(null);
                              setPendingVehicleStatusChange({
                                vehicleId: vehicle.id,
                                vehicleCode: vehicle.vehicleCode,
                                plateNumber: vehicle.plateNumber,
                                brandModel: vehicle.brandModel,
                                nextStatus: usageStatus === "使用中" ? "available" : "inUse"
                              });
                            }}
                          >
                            设为{usageStatus === "使用中" ? "空闲中" : "使用中"}
                          </button>
                          <button
                            aria-label={`删除车辆 ${vehicle.vehicleCode}`}
                            className="ghost-button ghost-button-danger"
                            type="button"
                            onClick={() => {
                              closeInlinePanels();
                              setUserManagementMessage(null);
                              setPendingDeleteVehicle(vehicle);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

              </section>
            ) : null}

            {view === adminRecordsView ? (
              <section className="management-panel" aria-label="用车记录管理">
                <BannerMessage message={userManagementMessage} />

                <section className="sheet-card filter-card">
                  <div className="filter-grid filter-grid-records">
                    <label className="field field-span-2">
                      <span>搜索记录</span>
                      <input
                        placeholder="搜索车牌、用车人、事由..."
                        value={recordFilters.keyword}
                        onChange={(event) => updateRecordFilter("keyword", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>按车辆筛选</span>
                      <select
                        value={recordFilters.vehicleId}
                        onChange={(event) => updateRecordFilter("vehicleId", event.target.value)}
                      >
                        <option value="">全部车辆</option>
                        {managedRecordVehicleOptions.map((vehicle) => (
                          <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                            {formatVehicleDisplay(vehicle)}
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
                        {[...new Set(managedRecords.map((record) => resolveRecordRegistrantName(record)).filter(Boolean))].map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field field-span-2">
                      <span>按日期筛选</span>
                      <input
                        aria-label="按日期筛选"
                        type="date"
                        value={recordFilters.businessDate}
                        onChange={(event) => updateRecordFilter("businessDate", event.target.value)}
                      />
                    </label>
                  </div>
                  <button className="filter-clear-button" type="button" onClick={clearRecordFilters}>
                    清空筛选
                  </button>
                </section>

                <div className="selection-toolbar">
                  <button
                    aria-label="全选当前筛选结果"
                    className="selection-toggle"
                    type="button"
                    onClick={() => {
                      setPendingDeleteRecord(null);
                      setUserManagementMessage(null);
                      setIsBulkDeleteOpen(false);
                      setSelectedRecordIds((current) =>
                        areAllFilteredRecordsSelected ? [] : filteredManagedRecords.map((record) => record.id)
                      );
                    }}
                  >
                    <span className={`checkbox-shell ${areAllFilteredRecordsSelected ? "checkbox-shell-active" : ""}`} />
                    <span>全选</span>
                    <span className="selection-divider">·</span>
                    <span>已选 {selectedRecordIds.length} 条</span>
                  </button>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      disabled={selectedRecordIds.length === 0}
                      type="button"
                      onClick={() => {
                        if (selectedRecordIds.length === 0) {
                          return;
                        }

                        setPendingDeleteRecord(null);
                        setUserManagementMessage(null);
                        setIsBulkDeleteOpen(true);
                      }}
                    >
                      批量删除
                    </button>
                  </div>
                </div>

                <div className="entity-list record-list">
                  {filteredManagedRecords.length === 0 ? (
                    <div className="empty-state empty-state-card">
                      <span className="empty-state-icon">
                        <AssetIcon name="emptyFile" />
                      </span>
                      <p>暂无符合条件的记录</p>
                    </div>
                  ) : null}
                  {filteredManagedRecords.map((record) => {
                    const isExpanded = expandedRecordId === record.id;
                    const departureDateTime = formatManagedRecordDateTime(record, record.departureTime);
                    const returnDateTime = formatManagedRecordDateTime(record, record.returnTime, {
                      isReturn: true
                    });

                    return (
                      <article className={`record-card ${isExpanded ? "record-card-expanded" : ""}`} key={record.id}>
                          <label className="record-select record-select-card">
                            <input
                              aria-label={`选择记录 ${record.reason}`}
                              checked={selectedRecordIds.includes(record.id)}
                              type="checkbox"
                              onChange={() => {
                                setUserManagementMessage(null);
                                setPendingDeleteRecord(null);
                                setIsBulkDeleteOpen(false);
                                setSelectedRecordIds((current) =>
                                  current.includes(record.id)
                                    ? current.filter((id) => id !== record.id)
                                    : [...current, record.id]
                                );
                              }}
                            />
                          </label>
                          <button
                            aria-expanded={isExpanded}
                            aria-label={`查看记录 ${record.reason}`}
                            className="record-summary-button"
                            type="button"
                            onClick={() => {
                              setUserManagementMessage(null);
                              setPendingDeleteRecord(null);
                              setExpandedRecordId((current) => (current === record.id ? "" : record.id));
                            }}
                          >
                            <span className="record-card-copy">
                              <span className="record-card-heading">
                                <strong>{formatVehicleDisplay(record)}</strong>
                                <span>·</span>
                                <strong>{resolveRecordRegistrantName(record)}</strong>
                              </span>
                              <span className="record-card-summary">
                                {record.businessDate} · {record.reason}
                              </span>
                            </span>
                            <AppIcon name="chevronRight" className="record-card-chevron" />
                          </button>
                          {isExpanded ? (
                            <div className="record-detail-panel">
                              <small>车辆：{formatVehicleDisplay(record)}</small>
                              <small>登记人：{resolveRecordRegistrantName(record)}</small>
                              <small>路线：{record.route}</small>
                              <small>加油：{formatFuelDisplay(record.fuelFee, record.fuelVolume)}</small>
                              {record.driverSignatureImage ? (
                                <div className="record-signature-preview">
                                  <span>手写签字预览</span>
                                  <button
                                    aria-label={`放大查看${resolveRecordRegistrantName(record)}的手写签字`}
                                    className="record-signature-preview-button"
                                    type="button"
                                    onClick={() =>
                                      setPreviewSignatureRecord({
                                        name: resolveRecordRegistrantName(record),
                                        image: record.driverSignatureImage
                                      })
                                    }
                                  >
                                    <img alt={`${resolveRecordRegistrantName(record)}的手写签字`} src={record.driverSignatureImage} />
                                  </button>
                                </div>
                              ) : null}
                              <small>
                                {departureDateTime}-{returnDateTime} · {record.distance} 公里
                                {record.isCrossDay ? " · 跨天" : ""}
                                {record.remark ? ` · ${record.remark}` : ""}
                              </small>
                              <button
                                aria-label={`删除记录 ${record.reason}`}
                                className="ghost-button ghost-button-danger record-delete-button"
                                type="button"
                                onClick={() => {
                                  setUserManagementMessage(null);
                                  setPendingDeleteUser(null);
                                  setPendingDeleteVehicle(null);
                                  setIsBulkDeleteOpen(false);
                                  setPendingDeleteRecord(record);
                                }}
                              >
                                删除记录
                              </button>
                            </div>
                          ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {view === adminPasswordView ? (
              <section className="management-panel" aria-label="修改密码" />
            ) : null}
          </div>
        </section>
      ) : null}

      <BottomSheet
        open={isAddUserOpen}
        title="新增用户"
        onClose={() => {
          setIsAddUserOpen(false);
          setNewUserErrors({});
          setNewUserForm({ fullName: "", username: "", password: "", role: "employee" });
        }}
      >
        <form className="bottom-sheet-form form" onSubmit={handleCreateUser} noValidate>
          <label className="field">
            <span>用户姓名</span>
            <input
              autoComplete="name"
              placeholder="请输入真实姓名"
              value={newUserForm.fullName}
              onChange={(event) => updateNewUserField("fullName", event.target.value)}
            />
            {newUserErrors.fullName ? <small className="error">{newUserErrors.fullName}</small> : null}
          </label>
          <label className="field">
            <span>新账号</span>
            <input
              autoComplete="off"
              placeholder="请输入账号"
              value={newUserForm.username}
              onChange={(event) => updateNewUserField("username", event.target.value)}
            />
            {newUserErrors.username ? <small className="error">{newUserErrors.username}</small> : null}
          </label>
          <PasswordField
            autoComplete="new-password"
            error={newUserErrors.password}
            label="初始密码"
            placeholder="请输入初始密码"
            value={newUserForm.password}
            onChange={(event) => updateNewUserField("password", event.target.value)}
          />
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
          <div className="action-row sheet-actions sheet-actions-split">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setIsAddUserOpen(false);
                setNewUserErrors({});
                setNewUserForm({ fullName: "", username: "", password: "", role: "employee" });
              }}
            >
              取消
            </button>
            <button className="primary-button primary-button-large" type="submit">
              提交新增
            </button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet
        open={Boolean(resetUser)}
        title="重置密码"
        onClose={() => {
          setResetUser(null);
          setResetPasswordErrors({});
          setResetPasswordForm({ newPassword: "", confirmPassword: "" });
        }}
      >
        <form className="bottom-sheet-form form" onSubmit={handleResetPassword} noValidate>
          {resetUser ? (
            <div className="sheet-context-row">
              <AssetIcon name="key" />
              <span>账号：</span>
              <strong>{resetUser.username}</strong>
            </div>
          ) : null}
          <PasswordField
            autoComplete="new-password"
            error={resetPasswordErrors.newPassword}
            label="新密码"
            placeholder="请输入新密码"
            value={resetPasswordForm.newPassword}
            onChange={(event) => updateResetPasswordField("newPassword", event.target.value)}
          />
          <PasswordField
            autoComplete="new-password"
            error={resetPasswordErrors.confirmPassword}
            label="确认新密码"
            placeholder="请再次输入新密码"
            value={resetPasswordForm.confirmPassword}
            onChange={(event) => updateResetPasswordField("confirmPassword", event.target.value)}
          />
          <div className="action-row sheet-actions sheet-actions-split">
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
            <button className="primary-button primary-button-large" type="submit">
              确认重置
            </button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet
        open={isAddVehicleOpen}
        title="新增车辆"
        onClose={() => {
          setIsAddVehicleOpen(false);
          setVehicleErrors({});
          setVehicleForm({ vehicleCode: "", plateNumber: "", brandModel: "", status: "available" });
        }}
      >
        <form className="bottom-sheet-form form" onSubmit={handleCreateVehicle} noValidate>
          <p className="sheet-helper-text">新增车辆默认状态为空闲中</p>
          <label className="field">
            <span>车辆编号</span>
            <input
              autoComplete="off"
              placeholder="例如：CAR-001"
              value={vehicleForm.vehicleCode}
              onChange={(event) => updateVehicleField("vehicleCode", event.target.value)}
            />
            {vehicleErrors.vehicleCode ? <small className="error">{vehicleErrors.vehicleCode}</small> : null}
          </label>
          <label className="field">
            <span>车牌号码</span>
            <input
              autoComplete="off"
              placeholder="例如：京A12345"
              value={vehicleForm.plateNumber}
              onChange={(event) => updateVehicleField("plateNumber", event.target.value)}
            />
            {vehicleErrors.plateNumber ? <small className="error">{vehicleErrors.plateNumber}</small> : null}
          </label>
          <label className="field">
            <span>品牌型号</span>
            <input
              autoComplete="off"
              placeholder="请输入品牌型号"
              value={vehicleForm.brandModel}
              onChange={(event) => updateVehicleField("brandModel", event.target.value)}
            />
            {vehicleErrors.brandModel ? <small className="error">{vehicleErrors.brandModel}</small> : null}
          </label>
          <div className="action-row sheet-actions sheet-actions-split">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setIsAddVehicleOpen(false);
                setVehicleErrors({});
                setVehicleForm({ vehicleCode: "", plateNumber: "", brandModel: "", status: "available" });
              }}
            >
              取消
            </button>
            <button className="primary-button primary-button-large" type="submit">
              提交新增
            </button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet
        open={isPasswordDialogOpen}
        title="修改密码"
        onClose={() => {
          setIsPasswordDialogOpen(false);
          resetPasswordModuleState();
        }}
      >
        <form className="bottom-sheet-form form" onSubmit={handleChangePassword} noValidate>
          <PasswordField
            autoComplete="current-password"
            error={passwordErrors.currentPassword}
            label="当前密码"
            placeholder="请输入当前密码"
            value={passwordForm.currentPassword}
            onChange={(event) => updatePasswordField("currentPassword", event.target.value)}
          />
          <PasswordField
            autoComplete="new-password"
            error={passwordErrors.newPassword}
            label="新密码"
            placeholder="请输入新密码"
            value={passwordForm.newPassword}
            onChange={(event) => updatePasswordField("newPassword", event.target.value)}
          />
          <PasswordField
            autoComplete="new-password"
            error={passwordErrors.confirmPassword}
            label="确认新密码"
            placeholder="请再次输入新密码"
            value={passwordForm.confirmPassword}
            onChange={(event) => updatePasswordField("confirmPassword", event.target.value)}
          />

          <BannerMessage message={passwordMessage} />

          <div className="action-row sheet-actions sheet-actions-primary-only">
            <button className="primary-button primary-button-large" type="submit">
              提交修改
            </button>
          </div>
        </form>
      </BottomSheet>

      <ConfirmDeleteModal
        {...(deleteModalConfig ?? {})}
        open={Boolean(deleteModalConfig)}
        title={deleteModalConfig?.title ?? "确认删除"}
      />
      <SignaturePreviewSheet
        open={Boolean(previewSignatureRecord)}
        title={previewSignatureRecord ? `${previewSignatureRecord.name}的手写签字` : "手写签字预览"}
        imageSrc={previewSignatureRecord?.image ?? ""}
        onClose={() => setPreviewSignatureRecord(null)}
      />
    </main>
  );
}
