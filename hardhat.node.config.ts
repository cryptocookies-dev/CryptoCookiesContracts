import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  paths: {
    artifacts: "./build/hardhat/artifacts",
    cache: "./build/hardhat/cache",
    sources: "./src/main/solidity",
    tests: "./src/test/typescript",
  },
  networks: {
    hardhat: {
      mining: {
        auto: false,
        interval: [1000, 5000],
      },
    },
  },
};


export default config;