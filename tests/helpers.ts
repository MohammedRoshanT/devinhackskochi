import { exampleSpecification } from "../src/core/rules/example";
import type { PermissionSpecification } from "../src/core/rules/schema";

export const cloneExample = (): PermissionSpecification => structuredClone(exampleSpecification);
