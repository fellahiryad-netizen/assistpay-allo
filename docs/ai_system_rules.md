# AI Coding Context & Senior Architectural Rules

This document establishes the mandatory standards, architectural principles, stack specifications, and code generation rules for all AI interactions when building or modifying this application.

---

## 1. Persona & Foundational Principles

### 1.1 Senior Engineering Standard
- Write production-grade, complete code. Never output incomplete code, stubs, mock implementations, or comments like `// ... rest of code` or `// TODO`.
- Design for maintainability, high testability, low coupling, and robust error resilience from day one.
- Handle edge cases, dynamic routing boundaries, loading states, and exception paths explicitly.

### 1.2 Core Architectural Principles
- **Separation of Concerns:** Strictly decouple UI rendering from business logic, dynamic state side-effects, and database access.
- **Single Responsibility Principle (SRP):** Keep components, hooks, functions, and modules small and focused on a single responsibility.
- **Type Safety & Validation:** Rely on strict typing and parse dynamic input data at every external boundary using runtime schema validation.
- **Defensive Programming:** Assume external APIs, network connections, user inputs, and database queries can fail. Handle all failure scenarios gracefully.

---

## 2. Tech Stack Specification

| Layer | Standard Technology |
| :--- | :--- |
| **Framework** | Next.js (App Router, Server Components by default) |
| **Language** | TypeScript (Strict Mode enabled) |
| **Styling** | Tailwind CSS + Radix UI / Shadcn UI primitives |
| **State Management** | React Server Components + Local React State + Zustand (Global Client State) |
| **Validation** | Zod |
| **Database & ORM** | PostgreSQL + Prisma ORM |
| **API & Actions** | Next.js Server Actions & Route Handlers with Zod validation |
| **Icons & Assets** | Lucide React |

---

## 3. Directory Blueprint & Module Boundaries

All code must strictly follow this feature-driven Clean Architecture directory layout:

```text
src/
├── app/                    # Routing, Page Layouts, Server Actions, Route Handlers ONLY
│   ├── (auth)/             # Route groups (e.g., authentication flow)
│   ├── api/                # Webhooks and external REST route handlers
│   └── actions/            # Light Server Action wrappers (delegates to services)
├── components/             # Shared cross-domain UI components
│   ├── ui/                 # Atomic design system / Shadcn primitive components
│   └── common/             # Layout primitives, Modals, Navbars, Header, Footer
├── features/               # Domain-driven feature modules
│   └── [feature-name]/
│       ├── components/     # Feature-specific UI components (Container & Presentational)
│       ├── services/       # Core business logic / domain use-cases
│       ├── schemas/        # Zod validation schemas
│       ├── types/          # Domain interfaces & TypeScript types
│       └── hooks/          # Custom hooks for interactive feature state
├── lib/                    # Infrastructure adapters (Prisma, Redis, Third-party clients)
├── types/                  # Global application-wide type definitions
└── utils/                  # Pure utility helper functions (stateless, side-effect free)
```

---

## 4. Strict Technical Standards

### 4.1 TypeScript Rules
- **No `any` or `ts-ignore`:** Never use `any`, `unknown` without dynamic validation, or `@ts-ignore` / `@ts-nocheck`.
- **Strict Typing:** Always use explicit type parameters and explicitly define return types on all exported functions, services, hooks, and server actions.
- **Interfaces vs Types:** Use `interface` for structural object definitions and `type` for unions, intersections, or primitives.

### 4.2 React & Next.js Standards
- **Server Components First:** All components inside `src/app` and `src/features` default to React Server Components (RSC).
- **Client Components ('use client'):** Add `'use client'` strictly at the top of leaf-node components requiring event listeners (`onClick`, `onChange`), browser APIs, or state hooks (`useState`, `useEffect`).
- **No Direct DB Calls in UI:** Server Components must NEVER make raw ORM queries or fetch directly from the database. Call dedicated domain service functions located in `src/features/[feature]/services/`.
- **Server Actions:** Must accept validated typed inputs, execute within a try-catch block, and return a standardized result object:
  ```typescript
  export type ActionResult<T> = 
    | { success: true; data: T }
    | { success: false; error: string; code?: string };
  ```

### 4.3 Clean Business Logic & Services
- Business logic MUST reside inside domain services (`[feature]/services/`).
- Services must remain framework-agnostic (no direct references to HTTP requests, response context, header manipulation, or Next.js route objects).
- Service methods must return structured results rather than throwing unhandled exceptions.

```typescript
// Standard Service Design Pattern Example
import { db } from "@/lib/db";
import { z } from "zod";
import { ActionResult } from "@/types";
import { UserProfile } from "../types";
import { userProfileSchema } from "../schemas";

export async function getUserProfileById(
  userId: string
): Promise<ActionResult<UserProfile>> {
  const validatedId = z.string().uuid().safeParse(userId);
  
  if (!validatedId.success) {
    return { success: false, error: "Invalid user identifier format." };
  }

  try {
    const profile = await db.userProfile.findUnique({
      where: { userId: validatedId.data },
    });

    if (!profile) {
      return { success: false, error: "User profile not found." };
    }

    return { success: true, data: profile };
  } catch (error) {
    // Log exception via centralized logging service
    console.error("Error fetching user profile:", error);
    return { success: false, error: "An unexpected database error occurred." };
  }
}
```

### 4.4 Component Architecture Guidelines
- **Container vs Presentational:** Keep state handling, data fetching, and event handlers separate from pure presentational elements.
- **Props Definition:** Export props interfaces for all UI components using `Readonly<Props>` wrappers.
- **State Granularity:** Prefer local state (`useState`) or URL state (`searchParams`) over global state. Use Zustand strictly when state must cross distant subtree boundaries.
- **Route Fallbacks:** Every dynamic route folder must include `loading.tsx` (using skeleton components) and `error.tsx` (using error boundaries).

### 4.5 Styling & Design System
- **Tailwind Utility Merging:** Always dynamic class lists using `cn()` (combining `clsx` and `tailwind-merge`).
- **Design Tokens:** Stick strictly to standard scale values defined in the Tailwind theme (colors, spacing, typography). Avoid arbitrary hardcoded values (e.g., `w-[327px]` or `bg-[#1a2b3c]`).
- **Mobile-First Responsiveness:** Build base layout targeting mobile screens first, applying breakpoint modifiers (`sm:`, `md:`, `lg:`, `xl:`) progressively.

---

## 5. Security & Performance Directives

- **Data Parsing:** Validate every external boundary (API parameters, query strings, form submissions, webhooks) using Zod schemas before processing.
- **Environment Variables:** Access environment variables strictly through a typed and validated `env` runtime module (e.g., `@t3-oss/env-nextjs`). Never read `process.env` directly in application components.
- **Authorization Check:** Perform authentication and permission checks on the service/action level, not just by hiding UI components visually.
- **Data Mutations:** Use React's `useOptimistic` hook and revalidation APIs (`revalidatePath`, `revalidateTag`) to handle data updates cleanly.

---

## 6. Rules for AI Assistance

When processing user requests and producing code artifacts:
1. Output complete, production-ready code with no omitted parts or placeholders.
2. Ensure imports rely on absolute paths configured via path aliases (`@/components/...`, `@/features/...`, `@/lib/...`).
3. Maintain exact architectural boundaries—never put database access into UI files, route handlers, or page views.
4. Include typed JSDoc documentation on exported public service interfaces, domain actions, and utilities.