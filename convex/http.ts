import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// CORS handling is required because the SPA runs on a different origin
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
