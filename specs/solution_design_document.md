# Solution Design Document

## Project Specific References

| SN | Reference Type / Description | Original Author/Owner | Reference Attachment / URL |
|---|---|---|---|
| 1 | Business Requirements (BRD) Document | Product Owner | |
| 2 | TAGC Presentation | Domain Architect | |
| 3 | Functional Specifications (FSD) | Business Analyst | |
| 4 | | | |

---

## Key Functional Requirements
*<<Extract key requirements applicable for this system from BRD>>*

---

## Key Non-Functional Requirements
*Please refer Slide 16 in TAGC Deck*

| SN | NFR | Requirements |
|---|---|---|
| 1 | Volumetric Projections (next 3 to 5 years) | |
| 2 | Maximum Load/Users | |
| 3 | Peak Load/Users | |
| 4 | Concurrent Users (TPS) | |
| 5 | Response Time (for key use cases) | |
| 6 | Any other relevant NFR to project... | |

---

## Relevant Use Cases
*<<Summarize use cases relevant to the system under design>>*

| SN | Use Case Title | Purpose / Expected Outcome | Dependency on other systems |
|---|---|---|---|
| 1 | | | |

---

## Design Principles
*<<Document design principles those will drive the solution>>*

---

## Design Assumptions
*<<Document assumptions on which the design/solution is built upon>>*

---

## Design Constraints / Limitations
*<<Document the out of scope, Limitations or Constraints of the design>>*

---

## High Level Flow
*<<Draw high level data and information flow within/across system under design>>*

---

## Solution Components
*<<List down components in the solution along with their responsibilities & boundaries>>*

| SN | Component Name | Description / Purpose / Role in overall design | Remarks / Additional information |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

---

## Sequence Diagrams (for use cases)

### Happy Flows
*<<Draw Sequence diagrams for use cases mentioned in above sections>>*

| SN | Use Case | Sequence Diagram |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

### Exception Flows
*<<Create separate sequence diagram for exception cases if required>>*

| SN | Use Case | Sequence Diagram |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |

---

## Inventory of Capabilities
*<<Fill up Capabilities table if application is using VAL for impact Analysis>>*

| SN | App Name | VAL ID | L1 Capability | L2 Capability | L3 Capability | New / Existing / Delete |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

---

## Inventory of Interfaces
*<<Document the interfaces provided by the system as well as consumed by the system>>*

### Interfaces Summary
*<<Document following details for the system interfaces>>*

| SN | Interface Name & Purpose | VAL ID | Online / Batch | Source System | Destination System | Integration Layer | New / Existing / Delete | Complexity |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | Web Service / MQ / EAI | Existing | Low/Medium/High |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

### Interfaces Details
*<<Document following details for the above mentioned system interfaces>>*

| SN | System Interface Name | Key Request Parameters | Key Response Parameters | Key Exceptions | Expected Timeout Setting |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

---

## Inventory of Reports
*<<Fill up Capabilities table if application is using VAL for impact Analysis>>*

| SN | App Name | VAL ID | Report Name | File Format | New / Existing / Delete |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

---

## Inventory of Test Cases
*<<List one row per test case. Give the serial number, test case ID, test type, test case description, and acceptance criteria. Test type must be one of Progression, Regression, Negative testing, or Non-functional.>>*

| SN | Test Case ID | Test Type | Test Case Description | Acceptance Criteria |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

## Database Design
*<<Draw details of database tables, fields and relationships>>*

### Data Model
*<<Draw the data model - highlight new and updated fields/tables>>*

### New/Updated Tables
*<<Document below details for updated and new tables in the database>>*  
**Table Name:**

| SN | Field Name | Field Type | Field Length | Field Description | Sample Values |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |

### Expected DB Size Growth
*<<Based on volumetric projections, calculate size growth of DB in next 3 to 5 years>>*

### Data Archival & Maintenance
*<<Provide details of batch, housekeeping and any other data archival related solution/approaches>>*

---

## Downstream Data Flow & Reports
*<<Draw overall data flow to the system and from the system>>*

---

## Application Security
*<<Document below applicable details with respect to application security>>*

### Customer Sensitive Data
*<<e.g., CIF, Name, Mobile Number etc...>>*

### Data Security-in-transit
*<<Document how data is protected over service/interface/facilities when moved in/out of the application>>*

### Data Security-at-Rest
*<<Document how data is protected when its stored in database/files>>*

---

## Resiliency Design
*<<Provide details on design to make the application more resilient by proactively addressing issues in run-time before the impact in production. The section will provide a holistic understanding of the application boundaries, dependencies (internal and external) to avoid cascading failures and reducing cycle time to recover in production.>>*

### Design and Runtime Isolation
*<<Provide details on how the new component or any enhancement is designed/isolated in the functions without impacting other functionalities within the module. If it impacts then please include details that should be deployed in end to end testing. The isolation details to be included in terms of functionality, API or Messages exposed to other applications, hosting (especially for Open Systems - JVM, VM, Database (Schema Level / Table Level / Database Level / VM Level). Refer to Multi-Tenancy - Approach - Domain Architecture & Engineering - UOB Confluence (uobnet.com) for guidance>>*

### Detection and Monitoring
*<<Provide details on Application Level Logs including Keywords to be used in Monitoring and Alerting Tools. The inputs will be used for doing log testing as well as for L3 and L2 support to debug incase of need to debug. Log level to at different levels (Info, warning, error, debug) to help diagnose issues. Refer to Logging Framework - Domain Architecture & Engineering - UOB Confluence (uobnet.com) for Guidance>>*

---

## Redundancy and Failover
*<<Provide details by systematically identify potential failure modes and their effects. Prioritize and address the most critical ones. This includes identifying the next system or application that will be integrating with the application being changed. List the failures and how the integrated/calling system should handle incase the primary system of change fails. Also include the controls in you system incase integrating system fails. Refer to the Application Failure Mode Analysis section in TAGC for guidance and add detailed scenarios based on design. Failure Mode and Effect Analysis (FMEA) - Domain Architecture & Engineering - UOB Confluence (uobnet.com)>>*

| Name | Application Name | DR Tier | Interface with Critical System/Tier 1-2 systems including MAS critical systems | Impact | Mitigating/Compensating controls: Circuit Breaker, Throttling, Retries, Timeouts (Yes or No) | Mitigating/Compensating controls: Description of all compensatory control to avoid cascading effect on other system due to failure of this system and vice versa (including Circuit Breaker, Throttling, Store and Forward.) including justification if not done | Mitigating/Compensating controls: Recovery approach (including Kill Switch, Back up, Bringing up new Instances, increasing VM's etc) |
|---|---|---|---|---|---|---|---|
| | | | | | | 1. | 2. |

---

## Recovery
*<<Provide the details of how the application will be recovered in case of a failure. This includes recovery of services, approach to deploying change/Rollback Strategy. What are the dependent systems/processes: Designing for Resilience: Proactive Recovery Strategies in Application Development - Domain Architecture & Engineering - UOB Confluence (uobnet.com)>>*

---

## Housekeeping
*<<Provide details of Database/File Maintenance (Regularly clean up outdated data, database indexes), Log Management (implement log rotation to prevent logs from consuming excessive disk space. Archive or delete old logs) and Temporary File Clean Ups (directory where temporary files created by your application or system processes). Housekeeping - Domain Architecture & Engineering - UOB Confluence (uobnet.com)>>*

### Database/File Maintenance

| Application Code | Program | Data Type (Customer, Account, Transaction, Documents) | Retention Period before archival (X days, Months, Years) | Execution Frequency (Daily, Weekly, Monthly) | Automated or Manual | Change as part of the design |
|---|---|---|---|---|---|---|
| | | | | | | |

### Log Management

| Application Code | Log File Name/Location | Retention Period before archival (X days, Months, Years) | Execution Frequency (Daily, Weekly, Monthly) | Automated or Manual | Change as part of the design |
|---|---|---|---|---|---|
| | | | | | |

---

## Deployment

### Components
*<<Document below information related to deployment of the components>>*

| SN | Component / System Name | Single Source / Multiple Sources per country | Single Deployment / Country-specific deployment |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

---

## EAI MQ and Handlers
*<<Document below information related to MQ and EAI Handlers used in the project>>*

| EAI Service Code | Transaction Description | Source System | Host System | XTH (Existing / New) | GTH (Existing / New) | MQO (Existing / New) | Comments |
|---|---|---|---|---|---|---|---|
| AC_MID_PMT_X | Internet Banking Payment from DGE | DGE-BFS | ATM-Host | New:<br>XT_DGB_004 | New:<br>BL_DGB_MID_001 | New:<br>MQO_ATMID_M04 | |

---

## End to End Systems Timeout
*<<Document below information related to UAT, PROD Timeout setting between source and destination systems for End-to-End use cases>>*

| Use Cases (Related to project) | Systems In Sequence Flow | Timeout Settings (seconds) |
|---|---|---|
| Client Details Validation & Signature decryption (pre-login) | TMRW | <<Timeout Setting>> |
| Get Eligible Accounts for Payment (post-login) | TMRW | <<Timeout Setting>> |