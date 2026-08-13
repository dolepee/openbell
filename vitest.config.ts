import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["agent/test/**/*.test.ts", "server/**/*.test.ts"],
    exclude: ["lib/**", "node_modules/**"]
  }
});
