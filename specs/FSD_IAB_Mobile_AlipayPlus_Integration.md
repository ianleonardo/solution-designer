# Functional Specifications Document (FSD)
## Cross-Border Mobile Payment Enhancement via Alipay+ Integration
### IAB Mobile Banking Platform & Middleware Services

---

## Document Control & Technical Metadata

| Attribute | Specification |
| :--- | :--- |
| **Document Title** | Functional Specifications Document (FSD) - IAB Mobile Alipay+ Enhancement |
| **Version** | 1.0.0 |
| **Document Status** | Approved for Sprint Development & Core Banking Integration |
| **Author** | Senior Lead Solutions Architect, IAB Digital Payments |
| **Reviewed By** | Principal Systems Architect (Core Banking), Lead Security Architect (DevSecOps) |
| **Approved By** | Head of Digital Engineering & Architecture, IAB |
| **Technical Partner** | Ant International Solutions Architecture Team (Alipay+) |
| **Release Target** | IAB Mobile Release v8.4.0 (iOS & Android) / Payment Gateway v4.2.0 |
| **Date** | October 2026 |

### Revision History
| Version | Date | Author / Role | Technical Change Description |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-08 | Lead Payment Solutions Architect | Initial technical blueprint: API taxonomy, sequence diagrams, and module specs |
| 0.2.0 | 2026-09-24 | Core Banking Tech Lead | Integrated ISO 8583 / ISO 20022 debit hooks, reversal states, and FX quote cache |
| 0.9.0 | 2026-10-06 | Security & DevSecOps Lead | Refined RSA-2048 / HMAC-SHA256 signature scheme, TOTP CPM token specs, and HSM |
| 1.0.0 | 2026-10-14 | Enterprise Architecture Board | Formal baseline approved for production engineering and QA test automation |

---

## 1. System Overview & End-to-End Architecture

The Alipay+ integration introduces a high-throughput, microservice-based integration layer connecting the **IAB Mobile Banking Application** (iOS & Android) with the **Ant International Alipay+ Partner Payment Gateway**, orchestrated through the **IAB Digital Payment Hub (BFF / Microservices)** and interacting synchronously with internal Core Banking and Risk engines.

### 1.1 High-Level Architectural Diagram

```
+----------------------------------------------------------------------------------------------------+
|                                    CLIENT APPLICATION TIER                                         |
|                                                                                                    |
|    +------------------------------------------------------------------------------------------+    |
|    |                                  IAB Mobile Application                                  |    |
|    |   +-----------------------+  +-----------------------+  +----------------------------+   |    |
|    |   |  CPM Paycode Engine   |  |   MPM Camera Scanner  |  | In-App / Online Cashier    |   |    |
|    |   |  - Dynamic TOTP Token |  |   - EMVCo / A+ Parser |  | - Deep Link Handler        |   |    |
|    |   |  - Max Brightness     |  |   - Real-time FX View |  | - Webview / App Handoff    |   |    |
|    |   |  - Anti-Screenshot    |  |   - 2FA Modal         |  | - Order Confirmation       |   |    |
|    |   +-----------------------+  +-----------------------+  +----------------------------+   |    |
|    |               |                          |                            |                  |    |
|    +---------------+--------------------------+----------------------------+------------------+    |
+--------------------|--------------------------|----------------------------|-----------------------+
                     |                          |                            |
          Mutual TLS 1.3 / Certificate Pinning / HMAC-SHA256 Request Signing
                     |                          |                            |
                     v                          v                            v
+----------------------------------------------------------------------------------------------------+
|                                  IAB MIDDLEWARE & BACKEND SERVICES                                 |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                          IAB API Gateway & Reverse Proxy (Kong Enterprise)                   |  |
|  |                          - Rate Limiting, WAF, JWT Validation, DDoS Shield                   |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                |                                                   |
|  +----------------------------------------------------------------------------------------------+  |
|  |                      IAB Digital Payment Hub (Spring Boot Microservices)                     |  |
|  |                                                                                              |  |
|  |   +--------------------------+  +--------------------------+  +--------------------------+   |  |
|  |   |  CPM Token Microservice  |  |  MPM Payment Orchestrator|  |   FX & Treasury Adapter  |   |  |
|  |   |  - TOTP Seed Manager     |  |  - Order State Machine   |  |   - Real-Time Rate Ingest|   |  |
|  |   |  - Hardware HSM Signer   |  |  - Two-Phase Commit      |  |   - Margin Calculation   |   |  |
|  |   +--------------------------+  +--------------------------+  +--------------------------+   |  |
|  |                 |                               |                           |                |  |
|  |   +--------------------------+  +--------------------------+  +--------------------------+   |  |
|  |   |   Risk & Fraud Engine    |  |  Reconciliation & Batch  |  |  Dispute & Refund Engine |   |  |
|  |   |  - Device Geofence Eval  |  |  - SFTP Clearing Parser  |  |  - Webhook Listener      |   |  |
|  |   |  - Velocity & MCC Filter |  |  - 3-Way Auto Matcher    |  |  - Reversal Automation   |   |  |
|  |   +--------------------------+  +--------------------------+  +--------------------------+   |  |
|  +----------------------------------------------------------------------------------------------+  |
|                     |                                              |                               |
+---------------------|----------------------------------------------|-------------------------------+
                      |                                              |
      Internal RPC / ISO 8583 / ISO 20022            Dedicated Leased Line / TLS 1.3 (Mutual Auth)
                      |                                              |
                      v                                              v
+-------------------------------------------+  +-----------------------------------------------------+
|        IAB CORE BANKING & LEDGER          |  |       ANT INTERNATIONAL (ALIPAY+ GLOBAL)            |
|                                           |  |                                                     |
|  - Real-Time CASA Balance Ingestion       |  |  - Alipay+ Partner Core Payment Gateway             |
|  - Synchronous Double-Entry Debit/Credit  |  |  - Global Merchant Clearing & Settlement Hub        |
|  - General Ledger Suspense Accounts       |  |  - Global Currency FX Wholesale Rate Engine         |
+-------------------------------------------+  +-----------------------------------------------------+
```

---

## 2. System Actors, Entities, & Protocol Governance

### 2.1 System Actors & Roles
* **Customer / End-User:** Authenticated retail banking mobile user holding a valid IAB credential.
* **IAB Mobile Client (App):** Native iOS (Swift) and Android (Kotlin) front-end application executing token display, camera scanning, and biometric signing.
* **IAB API Gateway (BFF):** Entry gateway responsible for edge security, token termination, device fingerprint validation, and routing.
* **Payment Orchestrator Service:** State machine managing the transaction lifecycle from inquiry to settlement.
* **Core Banking System (CBS):** Authoritative ledger maintaining customer deposit accounts (CASA) and posting financial entries.
* **Treasury Service:** Internal engine supplying real-time foreign exchange base rates and margin pricing rules.
* **Fraud Detection System (FDS):** Real-time anomaly and machine-learning risk evaluation engine.
* **Alipay+ Global Switch (Ant International):** The external partner network routing requests to global acquiring banks and merchants.

### 2.2 Communication Protocols & Security Standards
* **Mobile-to-BFF Communication:** HTTPS over TLS 1.3 with Certificate Pinning (Public Key Pinning). All request payloads digitally signed with device-generated asymmetric keys stored in Apple Secure Enclave / Android StrongBox.
* **BFF-to-Alipay+ Communication:** Dedicated leased line / AWS Direct Connect with mutual TLS (mTLS). Message-level signatures using RSA-2048 with SHA-256 (`RSA-SHA256`) or HMAC-SHA256 as mandated by Alipay+ Partner specifications.
* **BFF-to-Core Banking:** ISO 8583 / ISO 20022 financial messaging over TCP/IP with internal hardware security module (HSM) MAC verification.

---

## 3. Detailed Functional Modules & Technical Specifications

### 3.1 Module 1: Mobile UI & User Experience Engine
#### 3.1.1 Navigation & Entry Points
* The user accesses the feature via:
  1. Main Dashboard: Quick Action Widget `[ Global Pay / Alipay+ ]`.
  2. Bottom Navigation Bar: `[ Scan & Pay ]` (context-aware scanner supporting both domestic QR and Alipay+).
  3. Side Drawer / Travel Hub: `[ International Cross-Border Payments ]`.

#### 3.1.2 Screen Security & Anti-Fraud UI Rules
* **Screenshot Suppression:** 
  * Android: `window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)` activated on all Alipay+ screens.
  * iOS: Add a hidden `UITextField` with `isSecureTextEntry = true` to the view layer hierarchy, blanking out screen capture previews and preventing native screen recording.
* **Brightness Control:** When navigating to the CPM Barcode view, the app saves current brightness, overrides brightness to `1.0` (100%), and restores previous brightness upon screen exit.

---

### 3.2 Module 2: Consumer-Presented Mode (CPM / Dynamic Barcode Payment)

#### 3.2.1 Token Generation Architecture
* CPM relies on an 18 to 24-digit numeric dynamic payment code (Paycode).
* Format: `[Routing Prefix (4-6 digits)][Timestamp / Epoch Component (6 digits)][Unique Dynamic Cryptographic Token (8-12 digits)]`.
* Prefix assigned by Ant International to identify IAB as the issuing wallet: `2888XX`.

```
           Dynamic CPM Paycode Structure:
    +-----------------+-------------------+--------------------------+
    |  Issuer Routing |  Timestamp / Salt |  HSM-Encrypted Dynamic   |
    |  Prefix (6-dig) |     (6-digits)    |     Token (8-12 digits)  |
    |     288801      |      384920       |         7749102849       |
    +-----------------+-------------------+--------------------------+
```

#### 3.2.2 End-to-End CPM Sequence Flow

```
Mobile App                IAB BFF / Payment Hub           Alipay+ Gateway           Merchant POS
    |                              |                              |                      |
    |--- 1. Request Paycode ------>|                              |                      |
    |    (Biometric Verified)      |--- 2. Generate Token ------->|                      |
    |                              |    (Or compute via HSM)      |                      |
    |<- 3. Return Token (TTL:60s)-|                              |                      |
    |                              |                              |                      |
    | [Render Barcode & QR]        |                              |                      |
    |                              |                              |                      |
    |                              |                              |<-- 4. Scan Paycode --|
    |                              |<-- 5. Inquire / Pay Request -|    (Merchant Scans)  |
    |                              |    (Token, JPY 4500, MCC)    |                      |
    |                              |                              |                      |
    |                              |-- 6. Evaluate Risk (FDS)     |                      |
    |                              |-- 7. Lock FX Rate            |                      |
    |                              |-- 8. Debit Core Banking (CASA)                      |
    |                              |                              |                      |
    |                              |-- 9. Response OK (PayResult)->|                     |
    |                              |                              |--- 10. Print Slip -->|
    |                              |                              |    (Payment Success) |
    |<- 11. Push Notification ----|                              |                      |
    |    (Debited SGD 41.05)       |                              |                      |
```

#### 3.2.3 Functional Specifications for CPM
1. **Token Lifetime:** Valid for exactly 60 seconds from issuance.
2. **Auto-Refresh Daemon:** A background coroutine/thread monitors remaining TTL. At `T - 5s`, the app initiates an asynchronous network call to pre-fetch the next token, ensuring zero visual interruption for the user.
3. **Single-Use Enforcement:** Once an incoming payment authorization referencing a specific token is received by the IAB Payment Hub, that token is immediately flagged as `CONSUMED` in Redis cache (`SET token:status CONSUMED EX 120`). Any subsequent authorization attempt using the same token is rejected with error `PAYCODE_ALREADY_USED`.

---

### 3.3 Module 3: Merchant-Presented Mode (MPM / Scan & Pay)

#### 3.3.1 QR Parsing & Code Recognition
The scanner engine uses a high-performance C++ native QR decoding library (ZXing-C++ wrapper) capable of parsing EMVCo Merchant-Presented QR specifications and Alipay+ proprietary QR formats.

* **Parsing Rules:**
  1. Detect EMVCo Payload Format Indicator (Tag `00`).
  2. Parse Merchant Account Information (Tag `26`–`51` reserved for payment schemes).
  3. Extract Alipay+ Globally Unique Identifier (GUID): `ALIPAYPLUS` or Ant-assigned merchant routing URL.
  4. Identify Transaction Currency (Tag `53`, ISO 4217 numeric, e.g., `392` for JPY, `410` for KRW, `702` for SGD).
  5. Check Transaction Amount (Tag `54`): If present, process as **Dynamic MPM**; if absent, trigger **Static MPM** manual amount prompt.

#### 3.3.2 End-to-End MPM Sequence Flow

```
Mobile App                IAB BFF / Payment Hub           Alipay+ Gateway         Merchant POS / Stand
    |                              |                              |                      |
    |--- 1. Scan QR Code --------->|                              |                      |
    |    (EMVCo Payload)           |                              |                      |
    |                              |                              |                      |
    |--- 2. Inquire Merchant ----->|                              |                      |
    |    (Payload, Location)       |--- 3. Inquire Order/Merchant>|                      |
    |                              |    (alipay.payment.inquire)  |                      |
    |                              |<- 4. Return Merchant & FX ---|                      |
    |<- 5. Display Confirm Screen -|    (Merchant: Lawson Ginza,  |                      |
    |    (Amount, JPY/SGD Rate)    |     Rate: 0.00912, TTL: 90s) |                      |
    |                              |                              |                      |
    | [User Reviews & Biometrics]  |                              |                      |
    |                              |                              |                      |
    |--- 6. Submit Payment ------->|                              |                      |
    |    (Quote ID, Pin Signature) |                              |                      |
    |                              |-- 7. Validate Quote Validity |                      |
    |                              |-- 8. Hold/Debit Core Account |                      |
    |                              |                              |                      |
    |                              |-- 9. Execute Payment ------->|                      |
    |                              |    (alipay.payment.pay)      |--- 10. Notify POS -->|
    |                              |<- 10. Success Response ------|    (Merchant Green)  |
    |<- 11. Display E-Receipt -----|                              |                      |
```

---

### 3.4 Module 4: In-App / Online Cashier Checkout (E-Commerce)

#### 3.4.1 Universal Link & Deep Linking Specifications
* iOS Universal Link: `https://mobile.iab-bank.com/alipayplus/checkout`
* Android App Link: `https://mobile.iab-bank.com/alipayplus/checkout`
* Custom Scheme Fallback: `iabpay://alipayplus/checkout`
* **Query Parameters:**
  * `paymentSessionId`: Cryptographic session ticket generated by Alipay+ Cashier.
  * `orderId`: International merchant unique order reference.
  * `redirectUrl`: Merchant callback redirect URL.

#### 3.4.2 Session Verification & Security Handshake
1. App intercepts link and passes `paymentSessionId` to IAB BFF `/v1/payments/alipayplus/cashier/verify`.
2. BFF communicates with Alipay+ Cashier Inquiry API to validate that the session is active, unexpired, and authentic.
3. App presents an overlaid native bottom sheet showing merchant trade name, icon, total amount, and converted home currency.
4. User confirms with FaceID / Biometrics. BFF executes synchronous Core Banking debit and notifies Alipay+ Cashier.
5. Mobile App seamlessly transfers control back to the source merchant application with status `SUCCESS`.

---

### 3.5 Module 5: Real-Time Foreign Exchange (FX) & Fee Engine

#### 3.5.1 Quote Management & Validity Window
1. When an inquiry is initiated (MPM scan or CPM POS read), the system requests a guaranteed quote from Alipay+ via `/v1/fx/quote/inquire`.
2. The quote contains:
   * `baseCurrency`: Merchant Transaction Currency (e.g., `THB`).
   * `quoteCurrency`: Customer Account Billing Currency (e.g., `SGD`).
   * `exchangeRate`: Wholesale settlement rate (e.g., `1 THB = 0.0382 SGD`).
   * `quoteId`: Unique GUID valid for 90 seconds.
   * `validUntil`: Epoch millisecond timestamp.
3. The IAB Treasury microservice applies the configured retail pricing spread:
   $$	ext{Final Customer Rate} = 	ext{Alipay+ Base Rate} 	imes (1 + 	ext{Bank Spread Margin})$$
4. If the transaction is confirmed before `validUntil`, the locked rate is guaranteed. If expired, the mobile client must display an expiration modal: `Rate expired. Tap to refresh.`.

---

### 3.6 Module 6: Risk Management & Anti-Fraud Screening

#### 3.6.1 Pre-Authorization Risk Payload
Every payment request must be enriched with device telemetry and forwarded to the IAB Fraud Engine:
* `deviceFingerprint`: Unique hardware hash derived from Android DRM ID / iOS Keychain Vendor UUID.
* `geoCoordinates`: Latitude, longitude, horizontal accuracy, and mock-location flag.
* `networkCarrier`: Roaming mobile network operator (MCC/MNC).
* `ipAddress`: Egress public IP address and ISP routing classification.
* `mccCode`: Merchant Category Code.

#### 3.6.2 Rule Engine & Step-Up Matrix
| Condition / Rule | Risk Level | Action Executed |
| :--- | :--- | :--- |
| Amount <= USD $250 & Geolocation matches expected roaming corridor | Low | Approve with standard Biometric confirmation |
| Amount > USD $250 and <= USD $500 | Medium | Require Biometric + 6-Digit Transaction PIN |
| Amount > USD $500 OR Sudden high-risk MCC (Gambling, Jewelry, Wire) | High | Trigger Step-Up 2FA (Out-of-Band Push Notification / SMS OTP) |
| Device Jailbroken / Hook detected OR Mock Location active | Critical | Reject immediately (`ERR_DEVICE_SECURITY_BREACH`) |
| Velocity > 5 transactions within 2 minutes | Critical | Temporary lock on Alipay+ feature for 30 minutes |

---

### 3.7 Module 7: Core Banking Integration & Account Debiting

#### 3.7.1 Financial Accounting & Posting Model
All transactions follow a real-time synchronous debit model with immediate General Ledger (GL) double-entry posting:

$$egin{aligned}
	ext{Debit:} & \quad 	ext{Customer CASA Account} \quad (	ext{Amount in Home Currency}) \
	ext{Credit:} & \quad 	ext{IAB Alipay+ Settlement Clearing Nostro/Vostro Account} \quad (	ext{Amount in Home Currency})
\end{aligned}$$

#### 3.7.2 Transaction Atomicity & Reversal Handling
1. **Scenario A (Normal Flow):**
   * Step 1: Core Banking accounts debited successfully.
   * Step 2: Alipay+ Payment API returns `SUCCESS`.
   * Step 3: Transaction marked `COMPLETED`.
2. **Scenario B (Alipay+ Gateway Timeout):**
   * If the HTTP call to Alipay+ times out after 3,000ms:
   * The IAB Payment Hub triggers an automated inquiry (`alipay.payment.inquire`).
   * If inquiry returns `TRANSACTION_NOT_FOUND` or `FAILED`:
   * The Payment Hub automatically calls Core Banking Reversal API to credit the customer account immediately (`AUTO_REVERSAL_TIMEOUT`).

---

### 3.8 Module 8: Transaction History, Receipts, & Push Notifications

#### 3.8.1 Push Notification Template
```json
{
  "title": "Payment Successful",
  "body": "Paid JPY 5,200 (SGD 47.42) at FamilyMart Shibuya, Tokyo via Alipay+.",
  "data": {
    "transactionId": "TXN-20261014-884910",
    "screen": "TRANSACTION_RECEIPT"
  }
}
```

#### 3.8.2 E-Receipt Fields
* Payment Scheme Badge: Official "Alipay+" dual logo.
* Merchant Name & Category: `FamilyMart - Convenience Store (MCC 5411)`.
* Foreign Currency Amount: `JPY 5,200.00`.
* Exchange Rate: `1 JPY = 0.009119 SGD`.
* Converted Billing Amount: `SGD 47.42`.
* Bank Service Markup: `SGD 0.00 (Zero Cross-Border Fee Promotion)`.
* Account Debited: `Premier Checking (•••• 5821)`.
* Reference ID: `AP-IAB-20261014-991823719`.

---

### 3.9 Module 9: Refund & Reversal Processing

#### 3.9.1 Webhook Notification Handling
* Alipay+ delivers refund events via asynchronous webhook: `POST /v1/payments/alipayplus/webhook/refund-notify`.
* The webhook payload contains:
  * `refundId`: Unique refund identifier from Alipay+.
  * `originalPaymentId`: The initial payment transaction ID.
  * `refundAmount`: Amount in foreign merchant currency.
  * `settlementRefundAmount`: Amount in customer billing currency.

#### 3.9.2 Processing Logic
1. BFF verifies message signature using Alipay+ Public Key.
2. BFF checks for duplicate processing via Redis idempotency key `refund:id:{refundId}`.
3. System fetches original transaction record from `tbl_alipay_transaction`.
4. System executes Core Banking Credit to the original funding account.
5. Push notification is sent to customer: `Refund Received: SGD XX.XX from [Merchant Name]`.

---

### 3.10 Module 10: End-of-Day (EOD) Clearing, Settlement, & Reconciliation

#### 3.10.1 Daily SFTP File Exchange
* File Delivery Time: Daily at 04:00 UTC.
* Delivery Protocol: SFTP with PGP encryption.
* File Format: Alipay+ Standard Clearing File (CSV format with pipe `|` delimiters).

#### 3.10.2 Three-Way Automated Reconciliation Engine
```
+---------------------------------------------------------------------------------------+
|                                    DAILY RECONCILIATION                               |
|                                                                                       |
|   +-----------------------+   +-----------------------+   +-----------------------+   |
|   |   IAB Mobile Logs     |   |   Core Banking CASA   |   | Alipay+ Clearing File |   |
|   |  (Gateway Database)   |   |  (Financial Ledger)   |   |   (SFTP Ingested)     |   |
|   +-----------------------+   +-----------------------+   +-----------------------+   |
|               |                           |                           |               |
|               +---------------------------+---------------------------+               |
|                                           |                                           |
|                                           v                                           |
|                     +-------------------------------------------+                     |
|                     |     Automated 3-Way Reconciliation Job    |                     |
|                     +-------------------------------------------+                     |
|                               /                       \                              |
|                              v                         v                              |
|                     [Matched: 99.98%]        [Exceptions Queue]                       |
|                     - Auto-settle Nostro     - Timing differences                     |
|                     - Close Batch            - Currency rounding                      |
|                                              - Manual Ops Review                      |
+---------------------------------------------------------------------------------------+
```

---

## 4. API Specifications & Data Contracts

All endpoints consume and produce `application/json; charset=UTF-8`. Requests must contain standard signature headers.

### 4.1 Standard HTTP Request Headers
```http
POST /v1/payments/alipayplus/mpm/pay HTTP/1.1
Host: api.iab-bank.com
Content-Type: application/json; charset=UTF-8
X-IAB-Client-Version: 8.4.0
X-IAB-Device-ID: a9f838e1-92b1-4f10-b992-192837410293
X-IAB-Request-ID: 7b312e02-6c2e-4b47-a9a2-949182391028
X-IAB-Timestamp: 2026-10-14T12:30:45.120Z
X-Signature: algorithm=RSA-SHA256,keyId=iab_mobile_prod_1,signature=Kj8...==
```

---

### 4.2 Endpoint 1: Generate CPM Dynamic Paycode
* **Method & URI:** `POST /v1/payments/alipayplus/cpm/token`
* **Description:** Generates a dynamic 24-digit barcode/QR payload for user presentation at POS.

#### Request Payload:
```json
{
  "accountId": "ACC-9021-39281-01",
  "deviceInfo": {
    "deviceModel": "iPhone 16 Pro",
    "osVersion": "iOS 20.1",
    "appVersion": "8.4.0",
    "ipAddress": "198.51.100.42"
  },
  "authMethod": "BIOMETRIC_FACE_ID"
}
```

#### Response Payload (Success - 200 OK):
```json
{
  "responseCode": "SUCCESS",
  "responseMessage": "Paycode generated successfully",
  "data": {
    "paycode": "288801938201847192830192",
    "displayFormat": "BARCODE_AND_QR",
    "expiresInSeconds": 60,
    "validUntil": 1792067445000,
    "tokenRefreshThreshold": 5,
    "currency": "SGD",
    "linkedAccountMasked": "CASA •••• 9281"
  }
}
```

---

### 4.3 Endpoint 2: Inquire MPM Merchant QR Code
* **Method & URI:** `POST /v1/payments/alipayplus/mpm/inquire`
* **Description:** Parses scanned QR code payload, resolves merchant metadata, and returns real-time locked FX quote.

#### Request Payload:
```json
{
  "qrPayload": "00020101021226580010A0000007270114ALIPAYPLUS0212984918230192520454115303392540445005802JP5914LAWSON GINZA 6005TOKYO6304A1B2",
  "scannedTimestamp": 1792067500000,
  "userLocation": {
    "latitude": 35.6718,
    "longitude": 139.7650,
    "accuracy": 8.5
  }
}
```

#### Response Payload (Success - 200 OK):
```json
{
  "responseCode": "SUCCESS",
  "responseMessage": "Merchant resolved successfully",
  "data": {
    "merchant": {
      "merchantId": "AP_MER_JP_8839102",
      "merchantName": "LAWSON Ginza 4-Chome",
      "merchantCategory": "Convenience Stores",
      "mcc": "5411",
      "city": "Tokyo",
      "country": "JPN",
      "acquirerName": "Alipay+ Japan Network"
    },
    "transactionAmount": {
      "amount": "4500.00",
      "currency": "JPY"
    },
    "fxQuote": {
      "quoteId": "FXQ-20261014-99182371",
      "baseCurrency": "JPY",
      "quoteCurrency": "SGD",
      "exchangeRate": "0.00911850",
      "billAmount": "41.03",
      "bankMarginPercent": "0.00",
      "validForSeconds": 90,
      "validUntil": 1792067590000
    },
    "isDynamicAmount": true
  }
}
```

---

### 4.4 Endpoint 3: Submit MPM Payment Authorization
* **Method & URI:** `POST /v1/payments/alipayplus/mpm/pay`
* **Description:** Submits customer authorization to debit funding account and execute final settlement via Alipay+.

#### Request Payload:
```json
{
  "quoteId": "FXQ-20261014-99182371",
  "merchantId": "AP_MER_JP_8839102",
  "merchantAmount": {
    "amount": "4500.00",
    "currency": "JPY"
  },
  "billingAmount": {
    "amount": "41.03",
    "currency": "SGD"
  },
  "fundingAccountId": "ACC-9021-39281-01",
  "clientAuthPayload": {
    "authType": "BIOMETRIC",
    "authSignature": "MEYCIQDx...8gIhAM02...==",
    "authTimestamp": 1792067520000
  },
  "idempotencyKey": "IDEM-MPM-20261014-3819283719"
}
```

#### Response Payload (Success - 200 OK):
```json
{
  "responseCode": "SUCCESS",
  "responseMessage": "Payment authorized and executed successfully",
  "data": {
    "transactionId": "TXN-IAB-20261014-00192838",
    "alipayPaymentId": "20261014192830192830192837192",
    "status": "SUCCESS",
    "merchantName": "LAWSON Ginza 4-Chome",
    "merchantAmount": {
      "amount": "4500.00",
      "currency": "JPY"
    },
    "billedAmount": {
      "amount": "41.03",
      "currency": "SGD"
    },
    "exchangeRateApplied": "0.00911850",
    "completionTimestamp": 1792067521450,
    "receiptReference": "REC-99182381-01"
  }
}
```

---

### 4.5 Error Codes & Exception Taxonomy
| Error Code | HTTP Status | Root Cause & Remediation |
| :--- | :--- | :--- |
| `ERR_FX_QUOTE_EXPIRED` | 400 Bad Request | Quote exceeded 90-second TTL. UI prompts refresh. |
| `ERR_INSUFFICIENT_FUNDS` | 422 Unprocessable | CASA balance insufficient. UI prompts account selection. |
| `ERR_PAYCODE_EXPIRED` | 400 Bad Request | CPM Barcode scanned after 60s TTL. Merchant POS prompted to rescan. |
| `ERR_PAYCODE_ALREADY_USED` | 409 Conflict | Dynamic token already consumed. Potential replay attack blocked. |
| `ERR_LIMIT_EXCEEDED` | 403 Forbidden | Daily or per-transaction limit exceeded. Step-up required. |
| `ERR_SUSPECTED_FRAUD` | 403 Forbidden | FDS risk score breached threshold. Transaction declined. |
| `ERR_ALIPAY_GATEWAY_TIMEOUT` | 504 Gateway Timeout | Downstream Alipay+ API did not respond in 3s. Auto-reversal executed. |

---

## 5. Database Schema & Data Models

### 5.1 Primary Transaction Table (`tbl_alipay_transaction`)
```sql
CREATE TABLE tbl_alipay_transaction (
    txn_id VARCHAR(64) PRIMARY KEY,
    alipay_payment_id VARCHAR(64) UNIQUE,
    idempotency_key VARCHAR(64) UNIQUE NOT NULL,
    customer_cif VARCHAR(32) NOT NULL,
    funding_account_no VARCHAR(34) NOT NULL,
    payment_mode VARCHAR(16) NOT NULL, -- 'CPM', 'MPM', 'CASHIER'
    merchant_id VARCHAR(64) NOT NULL,
    merchant_name VARCHAR(255) NOT NULL,
    merchant_mcc VARCHAR(8) NOT NULL,
    merchant_city VARCHAR(100),
    merchant_country VARCHAR(3) NOT NULL, -- ISO-3166-1 alpha-3
    trans_currency VARCHAR(3) NOT NULL,   -- ISO-4217 (e.g. 'JPY')
    trans_amount DECIMAL(18, 4) NOT NULL,
    bill_currency VARCHAR(3) NOT NULL,    -- ISO-4217 (e.g. 'SGD')
    bill_amount DECIMAL(18, 4) NOT NULL,
    fx_rate_applied DECIMAL(18, 8) NOT NULL,
    fx_quote_id VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,          -- 'PENDING','SUCCESS','FAILED','REVERSED','REFUNDED'
    risk_score INT NOT NULL,
    core_banking_ref VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alipay_txn_cif ON tbl_alipay_transaction(customer_cif);
CREATE INDEX idx_alipay_txn_created ON tbl_alipay_transaction(created_at);
CREATE INDEX idx_alipay_txn_status ON tbl_alipay_transaction(status);
```

### 5.2 Dynamic CPM Token Registry (`tbl_alipay_cpm_token`)
```sql
CREATE TABLE tbl_alipay_cpm_token (
    token_hash VARCHAR(64) PRIMARY KEY, -- SHA-256 hash of paycode
    customer_cif VARCHAR(32) NOT NULL,
    linked_account_no VARCHAR(34) NOT NULL,
    status VARCHAR(16) NOT NULL,        -- 'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'
    device_id VARCHAR(64) NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_cpm_token_lookup ON tbl_alipay_cpm_token(token_hash, status);
CREATE INDEX idx_cpm_token_expiry ON tbl_alipay_cpm_token(expires_at);
```

### 5.3 Daily Settlement Reconciliation Record (`tbl_alipay_recon_record`)
```sql
CREATE TABLE tbl_alipay_recon_record (
    recon_id VARCHAR(64) PRIMARY KEY,
    settlement_date DATE NOT NULL,
    txn_id VARCHAR(64) REFERENCES tbl_alipay_transaction(txn_id),
    alipay_payment_id VARCHAR(64) NOT NULL,
    internal_amount DECIMAL(18, 4) NOT NULL,
    settled_amount DECIMAL(18, 4) NOT NULL,
    settlement_currency VARCHAR(3) NOT NULL,
    match_status VARCHAR(20) NOT NULL, -- 'MATCHED', 'AMOUNT_MISMATCH', 'MISSING_INTERNAL', 'MISSING_ALIPAY'
    discrepancy_reason TEXT,
    resolved_by VARCHAR(64),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_recon_date_status ON tbl_alipay_recon_record(settlement_date, match_status);
```

---

## 6. Non-Functional Requirements (NFRs)

### 6.1 Performance, Latency, & Throughput
* **Peak Throughput:** Payment Hub must support 300 Transactions Per Second (TPS) baseline, burstable to 600 TPS.
* **Latency Benchmarks:**
  * CPM Token Generation: P99 < 350ms.
  * MPM Merchant & FX Inquiry: P99 < 600ms.
  * End-to-End Payment Submission & CBS Debit: P99 < 1,200ms.

### 6.2 Availability, Resilience, & High Availability (HA)
* **Uptime Service Level:** 99.99% annual system availability (< 52.6 minutes unscheduled downtime/year).
* **Multi-Region Active-Active Deployment:** Distributed across two cloud availability zones with automated circuit breakers (Resilience4j) for external Alipay+ gateway dependencies.

### 6.3 Security, Cryptography, & Compliance
* **Data in Transit:** TLS 1.3 mandatory; TLS 1.2 or below strictly rejected.
* **Data at Rest:** All databases encrypted using AES-256 with keys managed in Thales Hardware Security Modules (HSM).
* **Token Obfuscation:** Paycodes and customer PANs masked in application logs and trace diagnostics.

---

## 7. Testing, Certification, & Traceability Matrix

### 7.1 Testing Strategy
1. **Ant International Partner Sandbox Certification:** Execution of 142 official Alipay+ compliance test suites (covering CPM, MPM, In-App Cashier, partial refunds, network drops, and settlement file parsing).
2. **End-to-End Core Banking Integration Testing:** Automated simulation of 50,000 parallel debit/reversal events in pre-production staging.
3. **Penetration Testing & Red Teaming:** Mobile app binary reverse-engineering audit, dynamic tampering tests, and API boundary penetration test conducted by certified CREST auditors.

### 7.2 Requirements Traceability Matrix (RTM)

| BRD Requirement ID | Functional Module | FSD Section Reference | Test Case Suite ID |
| :--- | :--- | :--- | :--- |
| **BR-01** (Onboarding & Terms) | Module 1 (UI Engine) | Section 3.1 | `TC-ONB-01` to `08` |
| **BR-02** (CPM Barcode Mode) | Module 2 (CPM Token) | Section 3.2, 4.2, 5.2 | `TC-CPM-01` to `24` |
| **BR-03** (MPM Scan & Pay) | Module 3 (MPM Engine) | Section 3.3, 4.3, 4.4 | `TC-MPM-01` to `36` |
| **BR-04** (Online Cashier) | Module 4 (Cashier) | Section 3.4 | `TC-CSH-01` to `15` |
| **BR-05** (Real-Time FX) | Module 5 (FX Treasury)| Section 3.5, 4.3 | `TC-FX-01` to `18` |
| **BR-06** (Payment Limits) | Module 6 (Risk Engine) | Section 3.6 | `TC-LMT-01` to `12` |
| **BR-07** (Security & Fraud) | Module 6 (Risk Engine) | Section 3.6, 6.3 | `TC-SEC-01` to `30` |
| **BR-08** (Receipts & Push) | Module 8 (Receipts) | Section 3.8 | `TC-NOTIF-01` to `10` |
| **BR-09** (Refunds & Reversal)| Module 9 (Refunds) | Section 3.9 | `TC-REF-01` to `20` |
| **BR-10** (Reconciliation) | Module 10 (Recon) | Section 3.10, 5.3 | `TC-REC-01` to `14` |

---
