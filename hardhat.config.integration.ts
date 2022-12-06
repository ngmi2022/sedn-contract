import config from "./hardhat.config";

config.paths!.tests = "./integration";
config.mocha = {
    timeout: 3_000_000,
};

export default config;
