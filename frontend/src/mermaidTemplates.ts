/** The text a new flowchart block starts with. Mirrors DEFAULT_FLOWCHART in backend/app/flow.py. */
export const STARTER_FLOWCHART = "flowchart LR\n    Source[Source] --> System[System]\n    System --> Destination[Destination]";

/** The text a new sequence diagram block starts with. Mirrors STARTER_SEQUENCE in backend/app/flow.py. */
export const STARTER_SEQUENCE =
  "sequenceDiagram\n    actor User as User\n    participant System as System\n    User->>System: Request\n    System-->>User: Response";

/** Starters from before diagrams were written as text; a block that still holds one counts as empty. */
const LEGACY_STARTER_FLOWCHART =
  'flowchart LR\n    Source["Source"]\n    System["System"]\n    Destination["Destination"]\n    Source --> System\n    System --> Destination';

export const STARTER_DIAGRAMS = new Set([STARTER_FLOWCHART.trim(), STARTER_SEQUENCE.trim(), LEGACY_STARTER_FLOWCHART.trim()]);

export type MermaidTemplate = { id: string; label: string; text: string; hint: string };

/** Starting points offered by the Mermaid editor. */
export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  { id: "flowchart", label: "Flowchart", text: STARTER_FLOWCHART, hint: "Boxes and arrows: A[Box] --> B{Decision}" },
  {
    id: "swimlane",
    label: "Swimlane",
    text: "swimlane-beta LR\n    subgraph Customer\n        request[Request service]\n        receive[Receive update]\n    end\n    subgraph Support\n        triage[Triage request]\n        answer[Send answer]\n    end\n    request --> triage\n    triage -->|Known issue| answer\n    answer --> receive",
    hint: "A process split into lanes. Each subgraph is one lane",
  },
  { id: "sequence", label: "Sequence diagram", text: STARTER_SEQUENCE, hint: "Messages between systems: A->>B: Request, B-->>A: Reply" },
  {
    id: "class",
    label: "Class diagram",
    text: "classDiagram\n    class Payment {\n        +String id\n        +Decimal amount\n        +submit()\n    }\n    class Account {\n        +String number\n    }\n    Account \"1\" --> \"*\" Payment : owns",
    hint: "Classes, fields and relationships",
  },
  {
    id: "state",
    label: "State diagram",
    text: "stateDiagram-v2\n    [*] --> Received\n    Received --> Validated : valid\n    Received --> Rejected : invalid\n    Validated --> Settled\n    Settled --> [*]\n    Rejected --> [*]",
    hint: "States and transitions",
  },
  {
    id: "er",
    label: "Entity relationship",
    text: "erDiagram\n    CUSTOMER ||--o{ ACCOUNT : holds\n    ACCOUNT ||--o{ PAYMENT : makes\n    CUSTOMER {\n        string id\n        string name\n    }\n    PAYMENT {\n        string id\n        decimal amount\n    }",
    hint: "Tables and how they relate",
  },
  {
    id: "journey",
    label: "User journey",
    text: "journey\n    title Pay a bill\n    section Sign in\n      Open the app: 5: Customer\n      Enter the password: 3: Customer\n    section Pay\n      Choose the account: 4: Customer\n      Confirm the payment: 5: Customer, Bank",
    hint: "Tasks scored from 1 to 5, with the people who do them",
  },
  {
    id: "c4",
    label: "C4",
    text: 'C4Context\n    title Internet banking\n    Person(customer, "Customer", "A bank customer")\n    System(banking, "Internet Banking", "Views accounts and pays bills")\n    System_Ext(email, "Email", "Sends mail")\n    Rel(customer, banking, "Uses")\n    Rel(banking, email, "Sends", "SMTP")',
    hint: "People, systems and how they relate",
  },
  {
    id: "architecture",
    label: "Architecture",
    text: "architecture-beta\n    group api(cloud)[API]\n    service db(database)[Database] in api\n    service server(server)[Server] in api\n    db:R --> L:server",
    hint: "Services, groups and the links between them",
  },
  {
    id: "block",
    label: "Block",
    text: 'block-beta\n    columns 3\n    Customer["Customer"] Account["Account"] Payment["Payment"]\n    Customer --> Account\n    Account --> Payment',
    hint: "Blocks in columns, with arrows between them",
  },
  {
    id: "requirement",
    label: "Requirement",
    text: "requirementDiagram\n    requirement pay {\n    id: 1\n    text: the customer can pay a bill\n    risk: medium\n    verifymethod: test\n    }\n    element gateway {\n    type: service\n    }\n    gateway - satisfies -> pay",
    hint: "Requirements, elements and how they satisfy each other",
  },
  {
    id: "usecase",
    label: "Use case",
    text: 'usecase-beta\n    direction LR\n    actor Customer\n    actor Bank\n    systemBoundary Payments\n      SignIn("Sign in")\n      Pay("Pay a bill")\n    end\n    Customer --> SignIn\n    Customer --> Pay\n    Bank --> Pay',
    hint: "Actors, use cases and the system boundary",
  },
  {
    id: "mindmap",
    label: "Mind map",
    text: "mindmap\n  root((Payments))\n    Card\n      Auth\n      Capture\n    Transfer\n      Domestic",
    hint: "A topic with branches, indented under the root",
  },
  {
    id: "treeview",
    label: "Tree view",
    text: "treeView-beta\n    payments/\n        src/\n            pay.js\n        package.json\n        README.md",
    hint: "A folder tree. Indent each level, and end a folder name with /",
  },
];

/** Short reminders shown under the editor. */
export const MERMAID_SYNTAX_HELP: { title: string; lines: string[] }[] = [
  {
    title: "Flowchart",
    lines: ["flowchart LR  (or TB for top to bottom)", "A[Box] --> B(Rounded) --> C{Decision}", "C -->|Yes| D[Done]", "subgraph Name ... end"],
  },
  {
    title: "Sequence diagram",
    lines: ["sequenceDiagram", "actor U as User", "participant S as System", "U->>S: Request   (solid arrow)", "S-->>U: Reply    (dashed arrow)", "Note over S: A note"],
  },
  {
    title: "Other diagrams",
    lines: ["classDiagram, stateDiagram-v2, erDiagram", "journey, C4Context, architecture-beta, block-beta, swimlane-beta", "requirementDiagram, usecase-beta, mindmap, treeView-beta"],
  },
];
