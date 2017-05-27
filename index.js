const { name: PKG_NAME, version: PKG_VERSION } = require(`${__dirname}/package.json`);
const DEFAULT_PORT = 5000;

const express = require('express');
const wake = require('express-wake');
const rpc = require('express-rpc-beeson');
const local = require('local-rpc');
const got = require('got');
const { make } = require('sentencer');

const randomName = () => make('{{ adjective }}-{{ noun }}');

function microbrew(module, name = randomName(), remoteAliases = {}, tracer, debug, gateway) {
    const app = express();

    const { middleware: rpcMiddleware, consumeWith } = rpc(module, { debug });
    const serviceCall = (service, method, args, requestData) => {
        const run = consumeWith((url, options) => {
            options.headers = {
                'user-agent': `${name} (${PKG_NAME}/${PKG_VERSION})`,
                'x-wake-request-id': requestData.requestId,
                'x-wake-operation-id': requestData.operationId
            };
            options.encoding = null;
            // TODO here is where we can control the retry-on-error logic, after the consumer API is defined
            options.retries = 0;

            return got(url, options);
        });
        const buildConfig = aliasConfig => typeof aliasConfig === 'string' ? { host: aliasConfig } : aliasConfig;
        const resolve = service => service in remoteAliases ? buildConfig(remoteAliases[service]) : { host: service };
        const { host, port } = Object.assign({ port: DEFAULT_PORT }, resolve(service));

        return run(host, method, args, { port });
    };

    const ownTracer = traceData => tracer(Object.assign(traceData, { service: name, gateway: !!gateway }));
    const { middleware: wakeMiddleware, error: wakeError, decorator: traceFn, log } = wake(ownTracer, { debug });

    const doIO = io => typeof io === 'function' ? io() : io;
    const camelKebab = camel => camel.replace(/([a-z])([A-Z0-9])|([0-9])([a-zA-Z])/g, (_, l, u, ll, uu) => `${l||ll}-${u||uu}`).toLowerCase();
    const configTrace = (service, method) => service === 'io' ? { target: service } : { target: service, method };

    // we need a real function to have a this argument
    function proxy(service, method, ...args) {
        return service === 'io' ? doIO(method) : serviceCall(camelKebab(service), method, args, this);
    }

    const tracerProxy = traceFn(proxy, configTrace);

    function localHandler(service, method, ...args) {
        if (service === 'log') return log(method, ...args);
        else return tracerProxy(service, method, ...args);
    }

    local(localHandler);

    if (tracer) app.use(wakeMiddleware);
    if (!gateway) app.use(rpcMiddleware);
    if (tracer) app.use(wakeError);

    if (gateway) return app;
    else return function start(port = DEFAULT_PORT) {
        const server = app.listen(port);

        return { server, app };
    };
}

microbrew.debug = (module, name, remoteAliases, tracer) => microbrew(module, name, remoteAliases, tracer, true);
// debug is only relevant for the rpcMiddleware
microbrew.gateway = (module, name, remoteAliases, tracer) => microbrew(module, name, remoteAliases, tracer, false, true);

module.exports = microbrew;
