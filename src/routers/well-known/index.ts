import express from "express";
import {openidConfig} from "./openidConfig.js";

const wellKnownRouter = express.Router();

export {wellKnownRouter};

wellKnownRouter.get("/openid-configuration", openidConfig);
