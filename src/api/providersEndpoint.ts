import { Hono } from "hono";
import { listProviders } from "../providers";

export const providersRouter = new Hono();

providersRouter.get("", c => c.json(listProviders()));
