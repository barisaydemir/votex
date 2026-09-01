import { $ } from "./state.js";

export function setStatus(msg) {
  $("status").textContent = msg;
}
