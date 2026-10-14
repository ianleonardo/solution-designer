## **1\. Complete Functional Requirements**

### **1.1 User Roles and Access Management**

* **Role-Based Access Control (RBAC):** The system must support Admin, Checker, Maker, and Viewer roles.  
* **Admin:** Full access to all system settings, user management, global prompts, and template sequencing. Admins can edit or delete any Solution Design Document (SDD) without approval routing.  
* **Checker & Maker:** Can create, update, and delete SDDs. (Maker creates/edits; Checker approves changes to the generated baseline).  
* **Viewer:** Read-only access to the dashboard and generated SDDs. Cannot add, edit, or delete projects.  
* **Menu Visibility:** The Admin configuration menu must be strictly hidden from non-admin users.

### **1.2 Admin Configuration & Settings**

* **LLM Configuration:** Admins can define and switch the active LLM model.  
* **Prompt Management:** Admins can define the global system prompt and customize prompts at the document sub-layout level (e.g., specific instructions for generating the "Resiliency Design" or "High Level Flow" sections).  
* **Parameter Tuning:** Admins can set temperature and max\_words limits per sub-layout prompt.  
* **Dynamic Caching:** All changes to LLM settings, prompts, and templates must be reloaded into the application cache instantly without requiring a server restart.

### **1.3 Knowledge Base & RAG Management**

* **File Uploads:** System must accept .md, .pdf, and .html files to build the Retrieval-Augmented Generation (RAG) knowledge base.  
* **Entity Extraction:** The system must extract, structure, and assign unique IDs to the following inventory types:  
  * *Interfaces:* System, country, protocol, purpose, proposing logic, request/response fields, and samples.  
  * *Table Definitions:* System, country, table, column, purpose, keys.  
  * *Bitbucket Repos:* System, repo name, purpose, framework.  
  * *Capabilities:* System, L1 capability, L2 capability.  
  * *Reports:* System, L1 capability, L2 capability.  
  * *Guidelines:* Guideline name, purpose.

### **1.4 Project & Document Generation**

* **Project Constraint:** Each project can only have one active Solution Design Document.  
* **Input Ingestion:** Users can upload baseline project documents (High-Level Solution Plan, FSD, BRD, Epic/Story lists) in PDF, Markdown, or Excel formats.  
* **Inference & Generation:** The system will process uploaded baseline documents to generate a structured SDD based on the default solution\_design\_document.md layout, extracting relevant data for sections like "Business Requirements", "Design Principles", and "Relevant Use Cases".  
* **Missing Information Alerts:** The system must actively notify the user if the uploaded baseline documents lack sufficient information to complete specific mandatory sections (e.g., missing NFR volumetric projections or database growth estimates).

### **1.5 Document Editor & Export**

* **Layout Sequencing:** Admins can alter the sequence of the generated document sections.  
* **Text & Table Editing:** Users (Admin/Maker/Checker) can manually refine generated text. For tables (e.g., "Inventory of Capabilities" or "Inventory of Test Cases"), users can perform inline CRUD operations (Add/Update/Delete rows).  
* **Diagram Editor:** The system defaults to generating diagrams in Mermaid.js (e.g., Happy/Exception Flow Sequence Diagrams). The UI must provide a drag-and-drop or visual editor to refine these diagrams and change sequence flows.  
* **Export Capabilities:** The finalized SDD can be exported as PDF, HTML, or Markdown.

### **1.6 Global Chat Widget**

* **Context-Aware Chat:** A persistent chat window available to all users for querying the current project context and the global RAG database.  
* **Guardrails:** The chat component must implement strict prompt injection protections and filters against unethical/out-of-scope queries.

## **2\. UI Layout**

The application will feature a responsive UI with a default **Dark Mode** theme (toggleable to Light Mode).

### **2.1 Main Navigation & Dashboard**

* **Top Nav:** User Profile, Theme Toggle (Light/Dark), Global Chat Widget toggle.  
* **Left Sidebar:** Dashboard, Projects, Knowledge Base (Admin only), Settings (Admin only).  
* **Dashboard View:**  
  * High-level statistics (Total Projects, Documents Generated, Pending Approvals).  
  * Data grid of existing projects with columns: Project Name, Status, Owner, Last Modified, Actions (View, Edit, Delete based on role).

### **2.2 Project Workspace (The Generator)**

* **Step 1: Baseline Upload:** Drag-and-drop zone for BRD, FSD, and Epic lists.  
* **Step 2: Generation Loader:** Progress indicator detailing which sections of the SDD are currently being synthesized.  
* **Step 3: Interactive Editor:**  
  * *Left Pane (Navigation):* Document outline matching the layout (e.g., "High Level Flow", "Database Design", "Deployment"). Highlights sections with "Missing Information" warnings.  
  * *Center Pane (Editor):* WYSIWYG/Markdown hybrid editor. Tables render as editable data grids. Diagrams render visually with an "Edit Mermaid" toggle or drag-and-drop overlay.  
  * *Right Pane (Prompts/Admin):* If Admin, a flyout to tweak the section's specific LLM prompt, temperature, and regenerate that specific section.

### **2.3 Admin Settings Panel**

* **LLM Setup:** Dropdowns for model selection, text inputs for global system prompts.  
* **Layout Manager:** A drag-and-drop list of document headers to define the default SDD template sequence.  
* **RAG Manager:** Table view of all uploaded knowledge documents, showing their unique IDs, categorized by inventory type (Interfaces, Repos, Capabilities).

## **3\. Table Design (DuckDB)**

The database will be structured in DuckDB. Below is the logical schema design.

| Table Name | Columns | Description |
| :---- | :---- | :---- |
| **Users** | user\_id (PK), username, role\_name, created\_at | Stores user credentials and RBAC roles (Admin, Checker, Maker, Viewer). |
| **Projects** | project\_id (PK), project\_name, owner\_id (FK), status, created\_at | Tracks high-level project containers. |
| **Layout\_Templates** | template\_id (PK), section\_name, sequence\_order, system\_prompt, temperature, max\_words | Defines the sequence and LLM behavior for sections like "Inventory of Reports" or "Redundancy and Failover". |
| **Generated\_SDDs** | sdd\_id (PK), project\_id (FK), content\_json, status, last\_modified | Stores the drafted/finalized document. content\_json holds the section-by-section breakdown. |
| **RAG\_Inventory** | rag\_id (PK), inventory\_type, system\_name, raw\_content, parsed\_json, embedding | Stores extracted entities (Capabilities, Interfaces, Repos). inventory\_type maps to the specific categories defined in requirements. |
| **Baseline\_Docs** | doc\_id (PK), project\_id (FK), file\_name, file\_type, uploaded\_by | Tracks BRDs, FSDs, etc., uploaded to a specific project for inference. |

## **4\. Technical Specifications**

### **4.1 Architecture**

* **Repository Structure:** Monorepo using a workspace manager (e.g., Nx or Yarn Workspaces).  
  * /frontend: React application.  
  * /backend: Python backend API.  
* **State & Caching:** Python backend utilizes in-memory caching (e.g., Redis or Python functools.lru\_cache with manual invalidation routes) to instantly reload Admin LLM settings without restarting the server.

### **4.2 Frontend (React)**

* **Framework:** React (Next.js recommended for routing and API abstraction, or Vite for pure SPA).  
* **Styling:** Tailwind CSS (built-in support for dark: variants to handle the default Dark Mode requirement).  
* **Diagrams:** mermaid.js integrated via react-mermaid or similar wrapper. Implement an interactive diagram library (like React Flow) for the drag-and-drop refinement, which syncs back to Mermaid syntax.  
* **Markdown/Text Editor:** TipTap or Milkdown for collaborative, block-based editing of generated content.

### **4.3 Backend (Python)**

* **Framework:** FastAPI (ideal for async LLM streaming and modular routing).  
* **LLM Integration:** LangChain or LlamaIndex for orchestration, RAG retrieval, and chaining prompts.  
* **Guardrails:** Implement NeMo Guardrails or Guardrails AI to enforce prompt injection protection and ethical boundaries on the global chat endpoint.  
* **Document Parsing:** PyMuPDF or pdfplumber for PDF extraction; pandas for Excel uploads; BeautifulSoup for HTML.

### **4.4 Database (DuckDB)**

* **Implementation:** DuckDB running in-process with the Python application.  
* **Storage:** Configured to read/write the .duckdb file directly to a Google Cloud Storage (GCS) Bucket using DuckDB's native HTTPFS extension, ensuring state persistence across container restarts.

## **5\. Deployment Guidelines**

### **5.1 Infrastructure Preparation (GCP)**

> 1. **Google Cloud Storage (GCS):**  
   * Create a bucket (e.g., sdd-generator-data-bucket).  
   * Create directories within the bucket: /duckdb (for the database file) and /uploads (for raw RAG files and project baselines).  
> 2. **Google Artifact Registry:** Create a Docker repository for hosting the frontend and backend container images.

### **5.2 Containerization**

* **Backend Dockerfile:** Expose port 8000 (FastAPI). Install DuckDB and required Python dependencies. Ensure GCP credentials (Service Account JSON) are mounted or passed via Workload Identity for GCS bucket access.  
* **Frontend Dockerfile:** Build the React app and serve via Nginx on port 80\.

### **5.3 Deployment Strategy (Google Cloud Run)**

* **Backend Service:**  
  * Deploy the backend image to Cloud Run.  
  * Set environment variables for the LLM API keys and GCS Bucket paths.  
  * Allocate sufficient memory (minimum 2GB-4GB) to handle concurrent document parsing and DuckDB query execution.  
* **Frontend Service:**  
  * Deploy the frontend image to Cloud Run.  
  * Set environment variables pointing the frontend to the Backend Cloud Run URL.

### **5.4 CI/CD Pipeline**

* Implement GitHub Actions, GitLab CI, or Google Cloud Build within the monorepo.  
* **Triggers:** Configure triggers on main branch merges.  
* **Pipeline Steps:**  
  1. Linter and Unit Tests (Python and React).  
  2. Build Docker images for /frontend and /backend.  
  3. Push images to GCP Artifact Registry.  
  4. Execute gcloud run deploy for both services, pointing traffic to the latest revisions.