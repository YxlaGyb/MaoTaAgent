#!/usr/bin/env node
/// The entry a kernel spawns. The plugin itself is in `plugin.ts`, so the rules
/// it applies can be exercised without a handshake.

import { runPlugin } from "@maota/plugin-kit";

import { definition } from "./plugin.ts";

runPlugin(definition);
