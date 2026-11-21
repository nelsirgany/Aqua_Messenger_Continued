// aquaFINAL.ino
// Aqua Messenger :: ESP32 hydrant monitor
//
// Two jobs:
//   1. Serve a local live dashboard over WiFi. This is the offline fallback:
//      if the venue blocks outbound HTTPS you can still show live sensor data
//      by connecting a laptop to http://aquamessenger.local
//   2. Report to the Aqua Messenger backend:
//        - POST /api/events    the instant the float changes state
//        - POST /api/heartbeat every HEARTBEAT_INTERVAL_MS, plus on boot
//
// NOTES ON THE FIXES IN THIS VERSION:
//   * FLOAT LOGIC WAS INVERTED in the original. With INPUT_PULLUP the pin
//     idles HIGH and reads LOW when the switch closes. See FLOAT_CLOSED_STATE.
//   * YAW ALARM REMOVED. Yaw is pure gyro integration with no magnetometer,
//     so it drifts continuously and would fire on its own after a few minutes
//     of sitting still. Pitch and roll come from the accelerometer, are
//     absolute against gravity, and do not drift. Yaw is display only.
//   * DEBOUNCE ADDED. A float at the waterline chatters.
//   * WIFI NO LONGER BLOCKS FOREVER on a bad network.
//   * BATTERY SENSE on ADC1 only; ADC2 stops working when WiFi is on. The
//     device reports raw pin volts and the SERVER applies divider_ratio from
//     battery_profiles, so changing the pack is a DB update, not a reflash.
//   * NTP CLOCK SYNC. The ESP32 has no RTC and boots at 1970, so recorded_at
//     would be meaningless or missing. configTime() fixes it. If NTP is
//     blocked the field is omitted and the server falls back to arrival time.
//
// PHYSICS NOTE, do not "fix" this later: NYC hydrants are dry-barrel. The
// barrel is empty unless the hydrant is open. Float wet == hydrant flowing.
// There is no water level to measure. It is one bit and that bit is enough.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <MPU6050.h>
#include <ESPmDNS.h>
#include <time.h>

// =========================================================
// CONFIG
// =========================================================

// ---------- WiFi ----------
const char *ssid     = "HACKIE001 5440";
const char *password = "p4J224-3";

// ---------- Backend identity ----------
// DEVICE_UID MUST match a row in the devices table or every POST returns 422.
// Check with:  select device_uid from devices order by device_uid;
const char *DEVICE_UID = "AQM-0001";
const char *API_BASE   = "https://aqua-messenger-x67c.vercel.app";   // no trailing slash
const char *AQUA_KEY   = "dev-only-shared-secret";        // X-Aqua-Key header

// ---------- Pins ----------
#define FLOAT_SWITCH_PIN 4
#define BATT_ADC_PIN     34    // ADC1 range is GPIO 32-39. ADC2 dies with WiFi.

// Set false until the voltage divider is actually soldered. When false the
// device omits battery_adc_v and the console honestly shows "not fitted"
// instead of inventing a voltage. Also set devices.has_battery_sense = false.
const bool HAS_BATTERY_SENSE = true;

// Which digital level means the float switch is CLOSED (water present)?
// With INPUT_PULLUP and the switch wired between the pin and GND, closed = LOW.
// If your Ximimark float is normally-closed, flip this to HIGH.
// TEST THIS ON THE BENCH: lift the float, watch Serial, confirm it flips.
#define FLOAT_CLOSED_STATE LOW

// ---------- Timing ----------
// DEMO VALUES. Restore the production values before the materials freeze.
const unsigned long HEARTBEAT_INTERVAL_MS = 30000UL;    // demo: 30 s
// const unsigned long HEARTBEAT_INTERVAL_MS = 7200000UL;  // production: 2 h
const unsigned long DEBOUNCE_MS = 2000UL;               // demo: 2 s
// const unsigned long DEBOUNCE_MS = 10000UL;             // production: 10 s

const unsigned long WIFI_TIMEOUT_MS   = 20000UL;
const unsigned long WIFI_RETRY_MS     = 30000UL;
const unsigned long broadcastInterval = 500UL;          // local dashboard push

// Any epoch below this means the clock has not been set yet.
const time_t MIN_VALID_EPOCH = 1700000000;

// =========================================================
// GLOBALS
// =========================================================

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
MPU6050 mpu;

float roll = 0.0f, pitch = 0.0f, yaw = 0.0f;
unsigned long lastFilterUpdate = 0;
unsigned long lastBroadcast    = 0;
unsigned long lastHeartbeat    = 0;
unsigned long lastWifiAttempt  = 0;

// Debounced float state machine
bool reportedFloatState = false;   // what the backend believes
bool candidateState     = false;   // what the pin currently reads
unsigned long candidateSince = 0;
bool floatStateInitialised = false;

bool imuOk = false;

// =========================================================
// LOCAL DASHBOARD PAGE
// =========================================================
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE HTML><html>
<head>
  <title>Aqua Messenger</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg-body: #0c1116;
      --bg-panel: #141b22;
      --bg-card: #1a232c;
      --bg-card-hover: #202b35;
      --border-subtle: #2a3540;
      --text-primary: #e8e6df;
      --text-muted: #8b9aa5;
      --accent: #4fb3bf;
      --accent-dim: #35747c;
      --ok: #5fb37c;
      --warn: #d9705a;
      --shadow: rgba(0, 0, 0, 0.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 40px 20px 60px; min-height: 100vh;
      background: radial-gradient(circle at top, #131a21 0%, var(--bg-body) 65%);
      font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif;
      color: var(--text-primary);
    }
    .page { max-width: 720px; margin: 0 auto; }
    header {
      text-align: center; margin-bottom: 36px; padding-bottom: 24px;
      border-bottom: 1px solid var(--border-subtle);
    }
    h1 { margin: 0 0 6px; font-size: 2.1rem; font-weight: 400; letter-spacing: 0.03em; }
    .subtitle { margin: 0; color: var(--accent); font-style: italic; letter-spacing: 0.04em; font-size: 0.95rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 32px; }
    .card {
      background: var(--bg-card); border: 1px solid var(--border-subtle);
      border-radius: 10px; padding: 20px 22px; box-shadow: 0 6px 16px var(--shadow);
      transition: background 0.25s ease, transform 0.25s ease;
    }
    .card:hover { background: var(--bg-card-hover); transform: translateY(-2px); }
    .label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-muted); margin-bottom: 10px; }
    .value { font-size: 2rem; font-weight: 400; letter-spacing: 0.02em; }
    .value.ok { color: var(--ok); }
    .value.triggered { color: var(--warn); animation: pulse 1.4s ease-in-out infinite; }
    .value.drift { color: var(--text-muted); font-size: 1.4rem; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
    .status-panel { text-align: center; padding: 14px 18px; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 8px; }
    #status { margin: 0 0 10px; font-size: 0.9rem; letter-spacing: 0.03em; color: var(--text-muted); font-style: italic; }
    #uplink { margin: 0 0 10px; font-size: 0.8rem; color: var(--text-muted); }
    #notifyBtn {
      font-family: inherit; font-size: 0.8rem; letter-spacing: 0.03em;
      color: var(--text-primary); background: var(--accent-dim);
      border: 1px solid var(--accent); border-radius: 6px; padding: 6px 14px; cursor: pointer;
    }
    #notifyBtn:hover { background: var(--accent); }
    #toastContainer { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 10px; z-index: 1000; }
    .toast {
      min-width: 220px; max-width: 320px; background: var(--bg-card);
      border: 1px solid var(--warn); border-left: 4px solid var(--warn);
      border-radius: 8px; padding: 12px 16px; box-shadow: 0 6px 16px var(--shadow);
      animation: toastIn 0.25s ease-out;
    }
    .toast .toast-title { font-size: 0.85rem; font-weight: 700; color: var(--warn); margin-bottom: 4px; }
    .toast .toast-body { font-size: 0.8rem; color: var(--text-muted); }
    @keyframes toastIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>Aqua Messenger</h1>
      <p class="subtitle">Live Sensor Dashboard</p>
    </header>

    <div class="grid">
      <div class="card">
        <div class="label">Hydrant state (float switch)</div>
        <div class="value" id="floatSwitch">&#8212;</div>
      </div>
      <div class="card">
        <div class="label">Roll (accelerometer, absolute)</div>
        <div class="value" id="roll">&#8212;</div>
      </div>
      <div class="card">
        <div class="label">Pitch (accelerometer, absolute)</div>
        <div class="value" id="pitch">&#8212;</div>
      </div>
      <div class="card">
        <div class="label">Yaw (gyro only &mdash; drifts, not alarmed)</div>
        <div class="value drift" id="yaw">&#8212;</div>
      </div>
    </div>

    <div class="status-panel">
      <p id="status">Connecting (Aqua Messenger is OFFLINE)...</p>
      <p id="uplink">Backend uplink: unknown</p>
      <button id="notifyBtn" onclick="requestNotificationPermission()">Enable Browser Notifications</button>
    </div>
  </div>

  <div id="toastContainer"></div>

<script>
  let gateway = `ws://${window.location.hostname}/ws`;
  let websocket;

  window.addEventListener('load', onLoad);

  function onLoad() {
    initWebSocket();
    requestNotificationPermission();
  }

  function initWebSocket() {
    websocket = new WebSocket(gateway);
    websocket.onopen = () => { document.getElementById('status').textContent = 'Connected'; };
    websocket.onclose = () => {
      document.getElementById('status').textContent = 'Disconnected. Retrying...';
      setTimeout(initWebSocket, 2000);
    };
    websocket.onmessage = onMessage;
  }

  function onMessage(event) {
    const data = JSON.parse(event.data);

    const fs = document.getElementById('floatSwitch');
    fs.textContent = data.floatSwitch ? 'FLOWING' : 'DRY';
    fs.className = 'value ' + (data.floatSwitch ? 'triggered' : 'ok');

    document.getElementById('roll').textContent  = data.roll.toFixed(1)  + '\u00B0';
    document.getElementById('pitch').textContent = data.pitch.toFixed(1) + '\u00B0';
    document.getElementById('yaw').textContent   = data.yaw.toFixed(1)   + '\u00B0';

    if (data.uplink !== undefined) {
      document.getElementById('uplink').textContent =
        'Backend uplink: ' + (data.uplink ? 'OK' : 'offline (local only)');
    }

    checkThresholds(data);
  }

  // Tilt alerts use pitch and roll only. Yaw is gyro-integrated with no
  // magnetometer, so it drifts and would false-alarm on its own.
  const TILT_THRESHOLD = 15;   // degrees from baseline

  let baseline = null;
  let lastFloatSwitch = null;

  function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    Notification.requestPermission();
  }

  function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: body, dir: "ltr" });
    }
    showToast(title, body);
  }

  function showToast(title, body) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function checkThresholds(data) {
    if (baseline === null) {
      baseline = { roll: data.roll, pitch: data.pitch };
      lastFloatSwitch = data.floatSwitch;
      return;
    }

    const rollDelta  = Math.abs(data.roll  - baseline.roll);
    const pitchDelta = Math.abs(data.pitch - baseline.pitch);

    if (rollDelta >= TILT_THRESHOLD || pitchDelta >= TILT_THRESHOLD) {
      sendNotification("Hydrant displaced", "Tilt from baseline detected. Possible vehicle strike or tampering.");
      baseline.roll  = data.roll;
      baseline.pitch = data.pitch;
    }

    if (data.floatSwitch !== lastFloatSwitch && data.floatSwitch === true) {
      sendNotification("Hydrant opened", "Water detected in the barrel. Hydrant is flowing.");
    }
    lastFloatSwitch = data.floatSwitch;
  }
</script>
</body>
</html>
)rawliteral";

// =========================================================
// TIME
// =========================================================

// The ESP32 has no battery-backed RTC. Without this, time(nullptr) returns
// something near zero and recorded_at is meaningless.
void syncTime() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Clock sync skipped: WiFi down");
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // UTC, no DST offset
  Serial.print("Syncing clock");
  time_t now = 0;
  int tries = 0;
  while (now < MIN_VALID_EPOCH && tries < 40) {        // up to 20 s
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    tries++;
  }
  Serial.println();
  if (now < MIN_VALID_EPOCH) {
    // NTP uses UDP 123, which some venue networks block. Not fatal: the
    // field is omitted and the server falls back to arrival time.
    Serial.println("Clock sync FAILED. recorded_at will be omitted.");
  } else {
    Serial.printf("Clock synced: %ld\n", (long)now);
  }
}

// Returns "2026-08-06T12:00:00Z", or an empty string if the clock is unset.
String isoNow() {
  time_t now = time(nullptr);
  if (now < MIN_VALID_EPOCH) return String("");
  struct tm t;
  gmtime_r(&now, &t);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// =========================================================
// SENSORS
// =========================================================

bool readFloatSwitch() {
  // Dry-barrel hydrant: barrel is empty unless the hydrant is open.
  // Closed switch == water present == hydrant flowing.
  return digitalRead(FLOAT_SWITCH_PIN) == FLOAT_CLOSED_STATE;
}

// Returns volts AT THE PIN, not pack volts. The server multiplies by
// divider_ratio from battery_profiles. Do not do that conversion here.
float readBatteryAdcV() {
  if (!HAS_BATTERY_SENSE) return -1.0f;
  uint32_t sum = 0;
  for (int i = 0; i < 32; i++) {
    sum += analogRead(BATT_ADC_PIN);
    delay(2);
  }
  return (sum / 32.0f) * (3.3f / 4095.0f);
}

void updateOrientation() {
  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  float accelRoll  = atan2(ay, az) * 180.0 / PI;
  float accelPitch = atan2(-ax, sqrt((float)ay * ay + (float)az * az)) * 180.0 / PI;

  float gyroRollRate  = gx / 131.0;   // MPU6050 default: 131 LSB per deg/s
  float gyroPitchRate = gy / 131.0;
  float gyroYawRate   = gz / 131.0;

  unsigned long now = millis();
  float dt = (lastFilterUpdate == 0) ? 0 : (now - lastFilterUpdate) / 1000.0f;
  lastFilterUpdate = now;

  // Complementary filter. The gyro is accurate over short intervals but
  // accumulates error; the accelerometer is noisy but absolute against
  // gravity. Weighting them 98/2 follows the gyro moment to moment while
  // the accelerometer slowly pulls the estimate back to truth, so the
  // angle neither drifts nor jumps around with vibration.
  const float alpha = 0.98f;
  roll  = alpha * (roll  + gyroRollRate  * dt) + (1 - alpha) * accelRoll;
  pitch = alpha * (pitch + gyroPitchRate * dt) + (1 - alpha) * accelPitch;

  // Yaw has no absolute reference without a magnetometer, so this integral
  // drifts without bound. Display only. Never alarm on it.
  yaw += gyroYawRate * dt;
}

// =========================================================
// BACKEND UPLINK
// =========================================================

bool postJson(const char *path, const String &body) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("POST skipped: WiFi down");
    return false;
  }
  WiFiClientSecure client;
  client.setInsecure();          // demo only. Pin a root cert for production.
  HTTPClient http;
  String url = String(API_BASE) + path;
  if (!http.begin(client, url)) {
    Serial.println("http.begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Aqua-Key", AQUA_KEY);
  int code = http.POST(body);
  Serial.printf("POST %s -> %d\n", path, code);
  if (code > 0 && (code < 200 || code >= 300)) {
    Serial.println("  body: " + http.getString());
  }
  http.end();
  return code >= 200 && code < 300;
}

String sensorPayload() {
  float adc = readBatteryAdcV();
  String s = "{";
  s += "\"device_uid\":\"" + String(DEVICE_UID) + "\",";

  String ts = isoNow();
  if (ts.length()) s += "\"recorded_at\":\"" + ts + "\",";

  s += "\"float_wet\":" + String(reportedFloatState ? "true" : "false") + ",";
  s += "\"pitch_deg\":" + String(pitch, 2) + ",";
  s += "\"roll_deg\":"  + String(roll, 2)  + ",";
  s += "\"imu_ok\":"    + String(imuOk ? "true" : "false") + ",";
  s += "\"rssi_dbm\":"  + String(WiFi.RSSI()) + ",";
  s += "\"uptime_s\":"  + String(millis() / 1000UL) + ",";
  s += "\"firmware\":\"0.3.0\"";
  if (adc >= 0) s += ",\"battery_adc_v\":" + String(adc, 3);
  return s;
}

bool sendHeartbeat(const char *trigger) {
  String body = sensorPayload() + ",\"trigger\":\"" + String(trigger) + "\"}";
  return postJson("/api/heartbeat", body);
}

bool sendEvent(bool opened) {
  String body = sensorPayload();
  // The events route expects occurred_at rather than recorded_at.
  String ts = isoNow();
  if (ts.length()) body += ",\"occurred_at\":\"" + ts + "\"";
  body += ",\"event\":\"" + String(opened ? "opened" : "closed") + "\"}";
  return postJson("/api/events", body);
}

// Debounced float state machine. A float sitting at the waterline chatters,
// and a hydrant takes several turns of a wrench to open, so requiring the
// state to hold costs nothing and removes all of the noise.
void serviceFloat() {
  
  bool now = readFloatSwitch();

  if (!floatStateInitialised) {
    reportedFloatState = now;
    candidateState = now;
    candidateSince = millis();
    floatStateInitialised = true;
    return;
  }

  if (now != candidateState) {
    candidateState = now;
    candidateSince = millis();
    return;
  }

  if (candidateState != reportedFloatState && millis() - candidateSince >= DEBOUNCE_MS) {
    reportedFloatState = candidateState;
    Serial.printf("Float transition -> %s\n", reportedFloatState ? "WET (flowing)" : "DRY");
    sendEvent(reportedFloatState);
  }
}

// =========================================================
// LOCAL DASHBOARD PUSH
// =========================================================

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WebSocket client #%u connected\n", client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WebSocket client #%u disconnected\n", client->id());
  }
}

void broadcastSensorData() {
  char json[192];
  snprintf(json, sizeof(json),
           "{\"floatSwitch\":%s,\"roll\":%.2f,\"pitch\":%.2f,\"yaw\":%.2f,\"uplink\":%s}",
           reportedFloatState ? "true" : "false",
           roll, pitch, yaw,
           WiFi.status() == WL_CONNECTED ? "true" : "false");
  ws.textAll(json);
}

// =========================================================
// WIFI
// =========================================================

void connectWifi() {
  Serial.printf("Connecting to %s", ssid);
  WiFi.begin(ssid, password);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    // Do not block. The local dashboard and Serial output still work, and
    // the loop retries every WIFI_RETRY_MS.
    Serial.println("WiFi timeout. Running local-only; will retry.");
  }
  lastWifiAttempt = millis();
}

// =========================================================
// SETUP / LOOP
// =========================================================

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(FLOAT_SWITCH_PIN, INPUT_PULLUP);

  if (HAS_BATTERY_SENSE) {
    analogSetPinAttenuation(BATT_ADC_PIN, ADC_11db);
  }

  Wire.begin();
  mpu.initialize();
  imuOk = mpu.testConnection();
  Serial.println(imuOk ? "MPU6050 connected." : "MPU6050 connection FAILED. Check wiring.");

  connectWifi();
  syncTime();

  if (MDNS.begin("aquamessenger")) {
    Serial.println("mDNS started: http://aquamessenger.local");
  }

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send_P(200, "text/html", index_html);
  });
  server.begin();

  // Seed the debounce state from the real pin before anything is reported.
  reportedFloatState = readFloatSwitch();
  candidateState = reportedFloatState;
  floatStateInitialised = true;
  Serial.printf("Initial float state: %s\n", reportedFloatState ? "WET" : "DRY");

  sendHeartbeat("boot");
  lastHeartbeat = millis();
}

void loop() {
  ws.cleanupClients();
  updateOrientation();
  serviceFloat();

  unsigned long now = millis();

  if (now - lastBroadcast >= broadcastInterval) {
    lastBroadcast = now;
    broadcastSensorData();
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    sendHeartbeat("scheduled");
  }

  if (WiFi.status() != WL_CONNECTED && now - lastWifiAttempt >= WIFI_RETRY_MS) {
    Serial.println("Retrying WiFi...");
    connectWifi();
    syncTime();
  }
}
