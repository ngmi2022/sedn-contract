import config from "./hardhat.config";

config.paths!.tests = "./integration";
config.mocha = {
    timeout: 1200_000,
};

export default config;
