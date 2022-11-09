import config from "./hardhat.config";

config.paths!.tests = "./integration";
config.mocha = {
    timeout: 500000,
};

export default config;
