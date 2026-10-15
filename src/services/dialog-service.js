// @ts-check

import { assertPort, PORT_METHODS } from "../contracts/ports.js";

export class DialogService {
    /** @param {any} dialogPort */
    constructor(dialogPort) { this.port = assertPort(dialogPort, "DialogPort", PORT_METHODS.dialog); }
    /** @param {Record<string, unknown>} options */
    open(options) { return this.port.open(options); }
    /** @param {number} id */
    close(id) { return this.port.close(id); }
    /** @param {string} message @param {Record<string, unknown>} options @param {(id: number) => void} yes @param {(id: number) => void} [onCancel] */
    confirm(message, options, yes, onCancel) { return onCancel ? this.port.confirm(message, options, yes, onCancel) : this.port.confirm(message, options, yes); }
    /** @param {string} message @param {Record<string, unknown>} [options] */
    alert(message, options) { return this.port.alert(message, options); }
}
