export type DeploymentState = "unmonitored" | "monitored" | "pilot_proposed";
export type ServiceState =
  | "unmonitored"
  | "never_reported"
  | "offline"
  | "out_of_service"
  | "flowing"
  | "in_service";
export type Severity = "info" | "warning" | "critical";
export type UseClassification = "unclassified" | "authorized" | "illegal" | "test";
export type HeartbeatTrigger = "scheduled" | "event" | "weekly_selftest" | "boot";

export interface HydrantStatus {
  hydrant_id: string;
  dep_unit_id: string;
  borough: string;
  street_address: string | null;
  latitude: number;
  longitude: number;
  deployment_state: DeploymentState;
  device_uid: string | null;
  last_heartbeat_at: string | null;
  currently_flowing: boolean;
  flowing_since: string | null;
  current_use_classification: UseClassification | null;
  critical_faults: number;
  service_state: ServiceState;
}

/** A device-side problem: offline, displaced, or IMU. Rendered in --alert.
 *  Distinct from a water-use problem, which is a human call. */
export function hasDeviceIssue(h: HydrantStatus): boolean {
  return (
    h.deployment_state === "monitored" &&
    (Number(h.critical_faults) > 0 ||
      h.service_state === "offline" ||
      h.service_state === "out_of_service" ||
      h.service_state === "never_reported")
  );
}

/** Water use a person has tagged illegal. Never inferred by the system. */
export function isIllegalUse(h: HydrantStatus): boolean {
  return h.currently_flowing && h.current_use_classification === "illegal";
}

export interface DeviceHealth {
  device_uid: string;
  dep_unit_id: string | null;
  street_address: string | null;
  firmware: string;
  last_heartbeat_at: string | null;
  float_wet: boolean | null;
  pitch_deg: number | null;
  roll_deg: number | null;
  tilt_delta_deg: number | null;
  open_faults: number;
  worst_severity: Severity | null;
  /** Fault titles, worst severity first — e.g. ["Hydrant displaced"].
   *  Empty when open_faults is 0. */
  open_fault_titles: string[];
}

export interface OpenEventRow {
  id: string;
  device_uid: string;
  dep_unit_id: string | null;
  street_address: string | null;
  borough: string | null;
  opened_at: string;
  closed_at: string | null;
  duration_seconds: number | null;
  duration_minutes: number | null;
  nominal_flow_gpm: number;
  est_gallons: number | null;
  use_classification: UseClassification;
  classified_by: string | null;
  classified_at: string | null;
}

export interface FaultCode {
  code: string;
  severity: Severity;
  title: string;
  detection: string;
  is_active: boolean;
}

export interface HeartbeatPayload {
  device_uid: string;
  recorded_at: string;
  trigger: HeartbeatTrigger;
  float_wet: boolean;
  pitch_deg: number;
  roll_deg: number;
  imu_ok: boolean;
  rssi_dbm?: number;
  uptime_s?: number;
  firmware?: string;
  selftest?: SelfTestPayload;
}

export interface SelfTestPayload {
  imu_i2c_ack: boolean;
  imu_self_test_passed: boolean;
  float_gpio_reads: "wet" | "dry";
  wifi_connect_ms: number;
  rtc_drift_s: number;
  free_heap: number;
  reset_reason: string;
}

export interface EventPayload {
  device_uid: string;
  event: "opened" | "closed";
  occurred_at: string;
  float_wet: boolean;
  pitch_deg: number;
  roll_deg: number;
}
