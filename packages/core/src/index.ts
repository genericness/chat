// Platform-agnostic core shared by the web app and the mobile app.
// Nothing in this package may depend on the DOM, Dexie, React, or any UI
// library — platform specifics come in through configureCore() (see config.ts).
export * from "./config"
export * from "./db-types"
export * from "./endpoint-test"
export * from "./models"
export * from "./openai"
