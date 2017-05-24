const { PKG_NAME, PKG_VERSION } = require('./package.json');
const DEFAULT_PORT = 5000;

const express = require('express');
const wake = require('express-wake');
const rpc = require('express-rpc-beeson');
const local = require('local-rpc');
const got = require('got');

// TODO name should not be mandatory. only module is mandatory....
function microbrew(name, module, aliases = {}, tracer, debug, gateway) {
    const app = express();

    const { middleware: rpcMiddleware, consumeWith } = rpc(module, { debug });
    const serviceCall = (service, method, args, requestData) => {
        const run = consumeWith((url, options) => {
            options.headers = {
                'user-agent': `${name} (${PKG_NAME}/${PKG_VERSION})`,
                'x-wake-request-id': requestData.requestId,
                'x-wake-operation-id': requestData.operationId
            };
            // TODO here is where we can control the retry-on-error logic, after the consumer API is defined
            options.retries = 0;

            return got(url, options);
        });
        const buildConfig = aliasConfig => typeof aliasConfig === 'string' ? { host: aliasConfig } : aliasConfig;
        const resolve = service => service in aliases ? buildConfig(aliases[service]) : { host: service };
        const { host, port } = Object.assign({ port: DEFAULT_PORT }, resolve(service));

        return run(host, method, args, { port });
    };

    const { middleware: wakeMiddleware, error: wakeError, decorator: traceFn } = wake(tracer);

    const doIO = io => typeof io === 'function' ? io() : io;
    const camelKebap = camel => camel.replace(/([a-z])([A-Z0-9])|([0-9])([a-zA-Z])/g, (_, l, u, ll, uu) => `${l||ll}-${u||uu}`).toLowerCase();
    const configTrace = (service, method) => service === 'io' ? { service } : { service, method };

    // we need a real function to have a this argument
    function proxy(service, method, ...args) {
        return service === 'io' ? doIO(method) : serviceCall(camelKebap(service), method, args, this);
    }

    local(traceFn('proxy', configTrace, proxy));

    if (tracer) app.use(wakeMiddleware);
    if (!gateway) app.use(rpcMiddleware);
    if (tracer) app.use(wakeError);

    if (gateway) return app;
    else return function start(port = DEFAULT_PORT) {
        const server = app.listen(port);

        return { server, app };
    };
}

microbrew.debug = (name, module, aliases, tracer) => microbrew(name, module, aliases, tracer, true);
// debug is only relevant for the rpcMiddleware
microbrew.gateway = (name, module, aliases, tracer) => microbrew(name, module, aliases, tracer, false, true);

module.exports = microbrew;
