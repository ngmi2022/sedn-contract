import config from "./hardhat.config";

config.paths!.tests = "./integration";
config.mocha = {
    timeout: 200000,
};

export default config;
