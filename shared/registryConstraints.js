export const REGISTRY_FIELD_LIMITS = {
  reason: 18,
  route: 64,
  remark: 12,
  mileageDigits: 8,
  fuelChars: 8
};

function readText(value) {
  return String(value ?? "");
}

function trimmedLength(value) {
  return readText(value).trim().length;
}

function numericDigitCount(value) {
  return readText(value).replace(/\D/g, "").length;
}

function hasValue(value) {
  return readText(value).trim().length > 0;
}

export function getRegistryConstraintErrors(values) {
  const errors = {};

  if (trimmedLength(values.reason) > REGISTRY_FIELD_LIMITS.reason) {
    errors.reason = `事由最多可填写${REGISTRY_FIELD_LIMITS.reason}个字，请精简后再提交`;
  }

  if (trimmedLength(values.route) > REGISTRY_FIELD_LIMITS.route) {
    errors.route = `目的地及行车路线最多可填写${REGISTRY_FIELD_LIMITS.route}个字，请精简后再提交`;
  }

  if (trimmedLength(values.remark) > REGISTRY_FIELD_LIMITS.remark) {
    errors.remark = `备注最多可填写${REGISTRY_FIELD_LIMITS.remark}个字，请精简后再提交`;
  }

  if (hasValue(values.startMileage) && numericDigitCount(values.startMileage) > REGISTRY_FIELD_LIMITS.mileageDigits) {
    errors.startMileage = `起步公里读数最多支持${REGISTRY_FIELD_LIMITS.mileageDigits}位数字，请检查后再提交`;
  }

  if (hasValue(values.endMileage) && numericDigitCount(values.endMileage) > REGISTRY_FIELD_LIMITS.mileageDigits) {
    errors.endMileage = `终点公里读数最多支持${REGISTRY_FIELD_LIMITS.mileageDigits}位数字，请检查后再提交`;
  }

  if (hasValue(values.fuelFee) && readText(values.fuelFee).trim().length > REGISTRY_FIELD_LIMITS.fuelChars) {
    errors.fuelFee = `加油费用最多可填写${REGISTRY_FIELD_LIMITS.fuelChars}个字符（含小数点），请检查后再提交`;
  }

  if (hasValue(values.fuelVolume) && readText(values.fuelVolume).trim().length > REGISTRY_FIELD_LIMITS.fuelChars) {
    errors.fuelVolume = `加油数量最多可填写${REGISTRY_FIELD_LIMITS.fuelChars}个字符（含小数点），请检查后再提交`;
  }

  return errors;
}
