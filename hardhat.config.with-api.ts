import config from "./hardhat.config";

config.paths!.tests = "./integration/with-api";
config.mocha = {
    timeout: 9_000_000,
};

export default config;
