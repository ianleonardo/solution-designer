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
    id: "gantt",
    label: "Gantt chart",
    text: "gantt\n    title Delivery plan\n    dateFormat YYYY-MM-DD\n    section Build\n    Design      :a1, 2026-01-05, 10d\n    Development :after a1, 20d\n    section Release\n    UAT         :10d\n    Go live     :milestone, 2026-03-01, 0d",
    hint: "Tasks on a timeline",
  },
  {
    id: "pie",
    label: "Pie chart",
    text: 'pie title Volume by channel\n    "API" : 55\n    "Batch" : 30\n    "File" : 15',
    hint: "Shares of a whole",
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
    lines: ["classDiagram, stateDiagram-v2, erDiagram", "gantt, pie, journey, mindmap, timeline", "Pick a template above to see the syntax."],
  },
];
