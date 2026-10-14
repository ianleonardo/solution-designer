# Business Requirements Document (BRD)
## Cross-Border Mobile Payment Enhancement via Alipay+ Integration
### IAB Mobile Banking Application

---

## Document Control & Metadata

| Field | Detail |
| :--- | :--- |
| **Document Title** | Business Requirements Document (BRD) - IAB Mobile Alipay+ Payment Integration |
| **Document Version** | 1.0.0 |
| **Document Status** | Approved for Baseline Architecture & Engineering |
| **Target Application** | IAB Mobile Application (iOS & Android) |
| **Core Initiative** | Cross-Border Merchant & Retail Payments Modernization |
| **Project Sponsor** | Head of Retail Banking & Digital Payments, IAB |
| **Lead Product Manager**| Digital Payments Squad Lead, IAB |
| **Lead Enterprise Architect** | Digital Channels & Payment Architecture, IAB |
| **Partner Integration Lead**| Global Wallet Partnerships, Ant International (Alipay+) |
| **Date of Creation** | October 2026 |
| **Classification** | Confidential - Internal Banking Operations & Certified Partners |

### Revision History
| Version | Date | Author / Role | Summary of Changes |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-01 | Lead Digital Payments PM | Initial draft outlining business scope, personas, and high-level use cases |
| 0.2.0 | 2026-09-18 | Business Analyst & Risk Lead | Incorporated AML/CFT compliance, FX quote locking, and settlement rules |
| 0.9.0 | 2026-10-02 | Joint Working Group (IAB + Ant Intl) | Added Online/In-App Cashier checkout, refund rules, and SLA definitions |
| 1.0.0 | 2026-10-14 | Product Steering Committee | Final sign-off baseline for technical implementation and QA staging |

### Stakeholder Sign-Off Matrix
| Role | Name | Department / Organization | Signature / Status |
| :--- | :--- | :--- | :--- |
| Head of Retail Banking | Arthur Henderson | IAB Retail Banking Division | Approved |
| Head of Digital Channels | Sarah Lin | IAB Technology & Digital Banking | Approved |
| Chief Risk Officer (CRO) | Marcus Vance | IAB Operational & Financial Risk | Approved |
| Head of Compliance & AML | Elena Rostova | IAB Regulatory Compliance | Approved |
| Head of Treasury Operations | David K. Tan | IAB Treasury & FX Dealing Desk | Approved |
| Partner Solutions Director | Kenji Takahashi | Ant International (Alipay+) | Approved |

---

## 1. Executive Summary & Project Background

### 1.1 Business Context & Strategic Drivers
International Asian Bank (IAB) serves over 4.8 million retail customers across Southeast Asia. In recent post-pandemic years, outbound consumer travel, cross-border business commuting, and international digital commerce have grown exponentially. Specifically, travel corridors between IAB’s home markets and major commercial hubs in Japan, South Korea, Mainland China, Singapore, Hong Kong SAR, Thailand, and Europe have experienced a 140% year-on-year surge in transaction volume.

Historically, IAB customers traveling abroad have relied primarily on:
1. Physical foreign currency exchange kiosks (incurring substantial cash holding risk and unfavorable bid-ask spreads).
2. Credit and Debit Cards (subject to foreign transaction fees of 2.5%–3.5%, unfavorable scheme card conversion rates, and frequent merchant terminal card acceptance limitations).

Alipay+ (operated by Ant International) is a global cross-border digital payment and marketing solution that connects global merchants with multiple international digital payment service providers (e-wallets and banking apps). Through a single technical partnership with Alipay+, IAB Mobile can immediately unlock payment acceptance at over 88 million merchants across 50+ countries and regions—including dominant retail chains (convenience stores, transit systems, airport duty-free outlets, luxury retailers, and dining franchises) throughout East Asia, Southeast Asia, Europe, and the Middle East.

### 1.2 Problem Statement
* **High Customer Friction:** Customers traveling abroad must carry physical cash or debit cards, often suffering declined card transactions due to automated fraud triggers at foreign point-of-sale (POS) terminals.
* **Lack of FX Transparency:** Traditional card-based transactions do not show the customer the exact final home-currency debit amount at the time of payment. The customer often only sees the converted charge days later when the transaction posts.
* **Loss of Cardless Market Share:** Digital-native competitors (fintech neobanks, cross-border multi-currency e-wallets) are siphoning transaction volume away from traditional IAB Current and Savings Accounts (CASA) during consumer international travel.
* **Limited Merchant QR Acceptance Abroad:** While IAB supports domestic QR payment standards (e.g., local central bank real-time QR schemes), these schemes do not extend seamlessly outside national borders without multilateral reciprocal arrangements.

### 1.3 Project Scope
The scope of this initiative encompasses enhancements across the IAB Mobile Banking App (iOS and Android), the middleware Digital Payment Hub (BFF & Microservices), Core Banking Account Debiting Services, Treasury FX Integration, Risk & Fraud Prevention Engines, and integration with the Ant International Alipay+ Partner Gateway.

#### In-Scope:
* **Consumer-Presented Mode (CPM):** Outbound dynamic barcode and QR generation displayed on the IAB Mobile App, scanned by overseas Alipay+ merchant barcode scanners (POS/handheld scanners).
* **Merchant-Presented Mode (MPM):** IAB Mobile camera scanner capability to scan and decode static or dynamic Alipay+ QR codes at global merchant checkouts.
* **Online & In-App Cashier Checkout:** Redirection and deep-link payments enabling IAB users to purchase from global online merchants (e.g., Agoda, Trip.com, international e-commerce platforms) accepting Alipay+.
* **Real-Time FX Transparency:** Real-time quote inquiry, lock-in mechanism (valid for 60 to 90 seconds), clear display of merchant currency, exchange rate, bank fee markup, and exact source account debit amount.
* **Core Account Integration:** Seamless direct debit from user-selected CASA (Current/Savings Account) or Multi-Currency Account (MCA).
* **Security & Step-Up 2FA:** Biometric authentication (FaceID, Fingerprint), 6-digit transaction PIN, automated velocity controls, and dynamic risk-based challenges.
* **Transaction History, E-Receipts, & Real-Time Push Alerts:** Push notifications, SMS, in-app transaction log, downloadable PDF receipts, and clear merchant location/category tagging.
* **Disputes, Reversals, & Partial/Full Refunds:** Automated processing of merchant-initiated refunds with transparent reverse FX handling.
* **Settlement & Reconciliation:** End-of-day automated clearing file processing, three-way financial reconciliation, and exception reporting.

#### Out-of-Scope:
* Merchant acquiring services by IAB for foreign wallets (this release focuses strictly on IAB as an **Issuing Wallet Partner**).
* Peer-to-peer (P2P) international remittances over Alipay+ (evaluated under Phase 3 roadmap).
* Physical card issuance under the Alipay+ brand.
* Cryptocurrency or digital asset settlement.

---

## 2. Stakeholder Analysis & User Personas

### 2.1 Key Stakeholder Matrix
| Stakeholder Group | Primary Interests & Expectations | Impact / Governance |
| :--- | :--- | :--- |
| **Retail Customers** | Instant, zero-friction payments abroad; clear, competitive FX rates; high acceptance in travel destinations; zero card skim risk. | Primary End-Users |
| **Retail Banking & Product** | Increase app stickiness, drive deposits retention, generate sustainable non-interest income (FX fee spread), grow cross-border interchange. | Project Owners |
| **Treasury & FX Desk** | Stable real-time wholesale FX ingestion, risk-free hedging during quote lock windows, configurable customer rate margins. | Operational Partner |
| **Compliance, AML, & Sanctions**| Full adherence to FATF recommendations, Sanctions screening (OFAC, UN, local Central Bank lists), Cross-Border Travel Rules, PEP screening. | Regulatory Gatekeepers |
| **Fraud & Risk Management** | Geofence risk verification, anomaly detection, device fingerprint integrity, velocity checks, prevention of account takeover (ATO). | Risk Gatekeepers |
| **Core IT & Infrastructure** | Ultra-low latency (<1.2s end-to-end), 99.99% system availability, microservice decoupling, resilient database partitioning. | Delivery & Operations |
| **Customer Service & Operations** | Comprehensive dispute console, clear visibility into refund/chargeback lifecycle, automated daily settlement reconciliation. | Support Operations |
| **Ant International (Alipay+)** | Strict conformance to Alipay+ Core Payment APIs, security certification, SLA compliance, standard brand badge presentation. | External Technology Partner |

### 2.2 Target User Personas
#### Persona 1: "The Leisure Traveler" (David, 32, Marketing Executive)
* **Behavior:** Travels to Tokyo and Seoul 3–4 times per year. Prefers traveling light without bulky wallets or excessive local currency cash.
* **Needs:** Wants to tap or show a QR code at 7-Eleven, Lawson, Don Quijote, and subway kiosks directly debited from his primary IAB checking account.
* **Pain Point:** Frustrated when physical cards trigger bank fraud blocks or when foreign ATM withdrawal fees exceed 10%.

#### Persona 2: "The Frequent Business Commuter" (Dr. Jessica, 45, Regional Consultant)
* **Behavior:** Visits client sites in Hong Kong, Singapore, and Bangkok every month. Purchases high-value dinners, executive transport, and regional flights.
* **Needs:** Instant push notifications with detailed electronic receipts categorized for corporate expense claims. High daily transaction limit options with secure biometric step-up.
* **Pain Point:** Ambiguity regarding the exchange rate applied until monthly credit card statements arrive.

#### Persona 3: "The Global Digital Shopper" (Aiden, 24, Software Engineer)
* **Behavior:** Shops online on international apparel, gaming, and digital service websites that feature Alipay+ checkout.
* **Needs:** One-tap mobile app redirection, authorization via FaceID, and immediate order fulfillment.
* **Pain Point:** Reluctance to type 16-digit debit card numbers and CVV codes onto foreign websites due to credential theft concerns.

---

## 3. Business Objectives & Success Metrics (KPIs)

| Objective | Key Performance Indicator (KPI) | Target (Year 1 Post-Launch) |
| :--- | :--- | :--- |
| **User Adoption** | Active Monthly Users performing >= 1 Alipay+ payment | 450,000 Unique Customers |
| **Transaction Volume** | Annual Gross Merchandise Value (GMV) processed | USD $280 Million |
| **Payment Success Rate** | Technical Transaction Success Rate (excluding customer balance shortage) | >= 99.65% |
| **System Latency** | End-to-end payment roundtrip time at merchant POS | < 1,500 milliseconds (P95) |
| **Customer Satisfaction** | Net Promoter Score (NPS) for Cross-Border Travel Features | >= +68 |
| **Fraud & Losses** | Net Fraud Loss Ratio | < 0.5 basis points (< 0.005%) |
| **Operational Efficiency** | Automated Clearing & Settlement reconciliation match rate | >= 99.98% without manual touch |

---

## 4. Detailed Business Requirements

### BR-01: Onboarding, Terms Acceptance, & Service Activation
* **BR-01.1:** The IAB Mobile App shall offer zero-effort pre-activation for eligible KYC-verified retail accounts. Customers who meet Tier-1 KYC verification shall not be required to submit additional identity documentation.
* **BR-01.2:** Upon first access to the "Global Pay / Alipay+" feature, the user shall be presented with the "IAB Cross-Border Payments Terms & Conditions" and "Alipay+ Data Processing Notice". Explicit acceptance via digital clickwrap is mandatory before feature enablement.
* **BR-01.3:** The user shall have the ability to toggle "Cross-Border Payment Mode" ON or OFF at any time within the app's Security & Card Settings.
* **BR-01.4:** The user shall be prompted to link a primary default funding account (Current Account, Savings Account, or Multi-Currency Account) with the option to switch funding accounts on the fly prior to payment confirmation.

### BR-02: Consumer-Presented Mode (CPM / Merchant Scan Consumer)
* **BR-02.1 (Dynamic Pay Code Generation):** When the user selects "Pay / Show Code" abroad, the app shall generate a secure, single-use, dynamic Alipay+ compliant barcode and 2D QR code (formatted in accordance with Alipay+ CPM technical specifications).
* **BR-02.2 (Security Screen Behavior):**
  * The barcode/QR display shall automatically maximize screen brightness to 100% to ensure smooth optical scanning by legacy POS scanners.
  * The app shall enforce OS-level screenshot and screen-recording prevention (using `FLAG_SECURE` on Android and view-layer masking on iOS).
* **BR-02.3 (Token Expiry & Countdown Timer):** The displayed dynamic code shall have a strict Time-To-Live (TTL) of 60 seconds. A visual circular countdown timer shall display remaining validity. When the timer hits zero, the token shall be invalidated and automatically refreshed with a new dynamic token without requiring manual reload.
* **BR-02.4 (Biometric Activation):** Accessing the payment code screen must require biometric verification (FaceID / Fingerprint) or 6-digit App Passcode if biometrics are unavailable.
* **BR-02.5 (Offline Code Pre-Fetching):** In areas with intermittent roaming data connectivity, the app shall support a secure pre-fetched vault of up to 3 encrypted dynamic offline tokens, provided the device passed online biometric validation within the preceding 15 minutes and the cumulative offline spend does not exceed USD $100 equivalent.

### BR-03: Merchant-Presented Mode (MPM / Consumer Scan Merchant)
* **BR-03.1 (QR Code Scanner):** The IAB Mobile App shall provide a high-performance in-app camera scanner that instantly recognizes and parses:
  1. Proprietary Alipay+ merchant QR codes.
  2. Local national QR codes integrated with Alipay+ (e.g., SGQR in Singapore, DuitNow QR in Malaysia, PromptPay in Thailand, ZeroPay in South Korea, PayPay in Japan).
* **BR-03.2 (Merchant & Order Inquiry):** Upon scanning an Alipay+ QR code:
  * For **Dynamic QR** (amount embedded): The app shall immediately extract the foreign transaction amount, merchant name, merchant ID, city/country, and Acquiring Partner badge.
  * For **Static QR** (countertop sticker): The app shall prompt the user to input the exact foreign currency bill amount.
* **BR-03.3 (Payment Confirmation Screen):** The screen must display:
  * Merchant Trade Name, City, Country, and Alipay+ verification badge.
  * Original Merchant Currency & Amount (e.g., `JPY 8,500`).
  * Real-Time Guaranteed Foreign Exchange Rate (e.g., `1 JPY = 0.00912 SGD`).
  * IAB Service / Spread Markup (e.g., `0.0% Promo Spread`).
  * Total Home Currency Debit Amount (e.g., `SGD 77.52`).
  * Selected Funding Account and Current Available Balance.
* **BR-03.4 (Rate Quote Lock):** The quoted FX rate shall remain locked for exactly 90 seconds. A countdown timer shall be visible. If the user does not confirm within 90 seconds, the app shall trigger an automated quote refresh and require the user to acknowledge any rate shift before confirming.

### BR-04: Online & In-App Cashier Checkout (E-Commerce)
* **BR-04.1 (Deep-Link / Universal Link Invocation):** When a user shops on an international mobile browser or merchant mobile app (e.g., Agoda, Trip.com, Shein) and selects "Alipay+ / IAB Mobile", the merchant checkout shall trigger an OS Universal Link / Deep-Link opening the IAB Mobile App.
* **BR-04.2 (Secure Order Handoff):** The app shall authenticate the user via Biometrics/PIN, validate the cryptographically signed order session token, and display the payment authorization modal showing order details, merchant brand, and locked FX rate.
* **BR-04.3 (Seamless Redirection):** Upon payment authorization, the app shall present a success animation, issue an immediate push receipt, and automatically redirect the user back to the merchant application or browser confirmation page with an authorized redirect payload.

### BR-05: Real-Time Foreign Exchange (FX) Transparency & Treasury
* **BR-05.1 (Rate Source):** Exchange rates shall be retrieved directly via the real-time Alipay+ Partner FX Inquiry API or IAB’s internal Treasury FX pricing engine (whichever provides the optimal competitive rate).
* **BR-05.2 (No Hidden Markups):** The customer must see a transparent breakdown. Hidden post-transaction foreign conversion surcharges are strictly prohibited.
* **BR-05.3 (Treasury Exposure Management):** The IAB Middle-Office Treasury service shall automatically aggregate intraday cross-border net clearing liabilities per currency corridor to execute automated hedging against foreign currency fluctuations.

### BR-06: Payment Limits & Funding Account Controls
* **BR-06.1 (Tiered Limit Configuration):** The system shall enforce configurable daily, weekly, and per-transaction limits:
  * **Default Per-Transaction Limit:** USD $250 equivalent (customizable up to USD $2,500 by user).
  * **Default Daily Cumulative Limit:** USD $1,000 equivalent (customizable up to USD $5,000 by user).
  * **High-Value Threshold:** Any single transaction exceeding USD $500 equivalent shall enforce mandatory Step-Up Two-Factor Authentication (Transaction PIN + In-App Secure Push confirmation).
* **BR-06.2 (Dynamic Limit Adjustment):** Users can adjust their cross-border payment limits in real time within the app settings, subject to a 12-hour cooling-off security delay when increasing limits above the default tier.

### BR-07: Security, Authentication, & Anti-Fraud Controls
* **BR-07.1 (Device Integrity & Jailbreak / Root Detection):** The app must refuse execution of the Alipay+ module if root access, jailbreak, unofficial emulator, active debugger, or malicious hook framework (e.g., Frida, Xposed) is detected.
* **BR-07.2 (Cryptographic Tokenization):** No sensitive funding account numbers (PAN, IBAN, full CASA account number) shall ever be transmitted across the Alipay+ network or exposed to the merchant. All payloads must utilize masked pseudonymous account identifiers.
* **BR-07.3 (Real-Time Fraud Engine Scoring):** Prior to authorizing payment, the transaction metadata (device geolocation, merchant MCC, velocity, IP subnet, device fingerprint) must pass through the IAB Risk & Fraud Engine. Transactions scoring above the risk threshold shall be declined or routed to step-up verification.
* **BR-07.4 (AML & Sanctions Screening):** Real-time automated screening against global sanctions lists (OFAC, UN, local sanctions) for merchant corporate entities and acquiring partner routing endpoints.

### BR-08: Transaction Notifications, Digital Receipts, & History
* **BR-08.1 (Instant Multi-Channel Alerts):** Upon successful payment authorization, the system must trigger:
  * In-App Push Notification within < 2 seconds.
  * SMS Alert for transactions exceeding USD $50 equivalent.
* **BR-08.2 (Itemized Digital E-Receipt):** The app shall generate a downloadable, shareable PDF/Image e-receipt containing:
  * Bank Reference Number & Alipay+ Global Partner Transaction ID.
  * Merchant Trade Name, Physical Address/City/Country, and MCC.
  * Transaction Date, Time (with local merchant time zone and home time zone).
  * Amount in Merchant Foreign Currency.
  * Executed Exchange Rate & Bank Margin.
  * Net Debited Home Account Amount & Masked Funding Account (`CASA ****4321`).
* **BR-08.3 (Interactive Transaction History):** The IAB Mobile transaction feed must clearly flag Alipay+ payments with distinct visual country flags, merchant logos, and a dedicated "Cross-Border / Travel" filter category.

### BR-09: Refunds, Reversals, & Dispute Resolution
* **BR-09.1 (Merchant-Initiated Full & Partial Refunds):**
  * The system must accept and process automated refund notifications initiated by Alipay+ merchants for up to 365 calendar days post-transaction date.
  * Partial refunds (e.g., returning one item from a multi-item purchase) must be supported.
* **BR-09.2 (Refund FX Rate Policy):**
  * Full refunds initiated within 24 hours of transaction time (same-day void/reversal) shall be credited at the **exact original transaction FX rate**, ensuring the customer suffers zero exchange rate loss.
  * Refunds processed after 24 hours shall be calculated based on the prevailing wholesale refund rate provided by Alipay+ at the exact time of refund submission, with zero bank penalty fees assessed to the consumer.
* **BR-09.3 (Customer Dispute & Chargeback Workflow):**
  * Customers shall have the ability to click "Raise Dispute / Report Issue" directly from any Alipay+ transaction detail screen in the mobile app.
  * Dispute reason codes (e.g., Goods Not Received, Duplicate Debit, Incorrect Amount Charged, Fraudulent Transaction) shall link directly into the IAB Core Dispute & Chargeback Management Portal with automated routing to Ant International dispute desk.

### BR-10: Clearing, Settlement, & Financial Reconciliation
* **BR-10.1 (Batch Clearing File Ingestion):** The banking backend shall automatically ingest and parse daily Alipay+ Clearing & Settlement Files (SFTP encrypted transfer in standard Alipay+ Settlement Report format) by 04:00 UTC daily.
* **BR-10.2 (Three-Way Automated Reconciliation):** The settlement engine shall perform automated three-way matching across:
  1. IAB Mobile Gateway Transaction Logs.
  2. IAB Core Banking Account Debits/Credits.
  3. Alipay+ Final Settled Transactions Report.
* **BR-10.3 (Suspense Account & Discrepancy Handling):** Unmatched items, timing differences, or rounding discrepancies shall be automatically flagged and posted to dedicated foreign currency clearing suspense accounts with automated alert tickets raised for Operations reconciliation officers.

---

## 5. Regulatory, Compliance, & Legal Requirements

| Regulation / Standard | Compliance Mandate | Application to Alipay+ Integration |
| :--- | :--- | :--- |
| **Central Bank Cross-Border Payment Guidelines** | Maximum daily limits, reporting of international capital movements. | Enforce statutory cross-border spending caps; automate daily foreign payment reporting files to regulatory bodies. |
| **FATF Recommendation 16 (Travel Rule)** | Accurate originator information accompanying wire and electronic transfers. | Pass encrypted originator identifier, customer name, and unique transaction token in settlement messaging. |
| **Personal Data Protection Act (PDPA / GDPR)** | Explicit user consent for cross-border transmission of personal data. | Display clickwrap data transfer disclosure; strictly mask customer PII; only transmit essential routing identifiers to Ant International. |
| **PCI-DSS Level 1 & PA-DSS** | Protection of cardholder and sensitive payment authentication tokens. | All token generation, storage, and transmission must utilize AES-256 and TLS 1.3 encryption. |
| **Consumer Protection / Fair Dealing Regulations** | Complete transparency regarding exchange rates and transaction fees. | Mandate upfront display of exact FX rate, spread, and debit amount prior to payment authorization. |

---

## 6. Assumptions, Dependencies, & Constraints

### 6.1 Assumptions
1. Customers engaging in Alipay+ cross-border payments hold an active, non-dormant, KYC-verified IAB retail CASA account with sufficient balance.
2. Merchants displaying Alipay+ signage possess active terminal capability certified by Ant International acquiring partners.
3. Alipay+ Gateway APIs maintain continuous 99.99% uptime with global multi-zone disaster recovery.

### 6.2 Dependencies
* **Ant International Alipay+ Partner Core API Certification:** Successful completion of end-to-end sandbox and production readiness certification for CPM, MPM, and Cashier APIs.
* **IAB Core Banking Real-Time Debit API:** Ultra-low latency internal microservice to lock and debit retail checking/savings accounts within < 300ms.
* **Treasury FX Dealing Engine:** Low-latency feed supplying real-time foreign currency bid-ask quotes with automated rate hedging.
* **Mobile Operating System Cryptographic Keystore:** Secure Enclave (iOS) and Hardware-backed Keystore / StrongBox (Android) for local dynamic token signing.

### 6.3 Constraints
* **Network Latency:** Cross-border internet routing between roaming mobile devices, IAB bank servers, and Ant International Asian data centers must complete within the strict POS timeout window (< 3 seconds total).
* **Display Constraints:** Barcode scanning requires minimum screen size and resolution standards; devices with cracked screens or malfunctioning optical cameras must be handled gracefully with clear user guidance.

---

## 7. Implementation Roadmap & Rollout Phasing

```
+---------------------------------------------------------------------------------------+
|  Q1 2026: Architecture & Sandbox Integration                                          |
|  - Finalize API contracts with Ant International                                       |
|  - Implement BFF Payment Microservices & Core Banking Debit Hooks                     |
|  - Sandbox testing of CPM and MPM API flows                                           |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Q2 2026: Mobile App Alpha Build & Security Certification                             |
|  - Develop iOS & Android Scanner and Dynamic Barcode Engine                           |
|  - Integrate FIDO2 Biometrics, Screen Security, and Hardware Keystore                 |
|  - Complete Third-Party Penetration Testing & PCI-DSS Audit                           |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Q3 2026: Pilot Pilot / Closed Beta (Japan & Singapore Corridors)                     |
|  - Internal staff pilot (5,000 users) across key travel destinations                   |
|  - End-to-end validation of EOD clearing, refunds, and reconciliation                 |
|  - Performance tuning to achieve P95 latency < 1.2s                                   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Q4 2026: General Public Commercial Launch                                            |
|  - Public rollout across 4.8M IAB Mobile user base                                     |
|  - Enable Online/In-App Cashier checkout for global partner e-commerce                |
|  - Launch marketing campaigns: "Spend Abroad with Zero Hidden FX Markups"             |
+---------------------------------------------------------------------------------------+
```

---

## 8. Business Acceptance Criteria

1. **UAT Sign-Off:** 100% of test scenarios covering CPM barcode display, camera MPM QR scanning, dynamic FX quote locking, biometric step-up, and timeout handling pass successfully.
2. **Pilot Success:** Minimum 10,000 real-world cross-border transactions processed during staff pilot with >= 99.7% technical completion rate and zero reconciliation imbalances.
3. **Regulatory Clearance:** Written concurrence from Compliance, AML, and Legal confirming full adherence to statutory cross-border remittance and travel rules.
4. **Operations Readiness:** Contact center and dispute management teams fully trained on Alipay+ back-office dispute portals, with standard operating procedures (SOP) published.

---
