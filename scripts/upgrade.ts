import * as fs from "fs";

// eslint-disable-next-line no-unused-vars
const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  const CookieHolder = await ethers.getContractFactory("CookieHolder");

  const address = fs.readFileSync(
    `./build/cookieHolderProxyAddress-${hre.hardhatArguments.network}.txt`,
    "utf8"
  );

  console.log("Upgrading CookieHolder proxy at " + address);
  await hre.upgrades.upgradeProxy(address, CookieHolder, {});
  console.log("CookieHolder upgraded");

  if (hre.hardhatArguments.network === "ganache" && hre.ethernal) {
    await hre.ethernal.push({
      name: "CookieHolder",
      address: address,
    });
    console.log("Pushed contract info to Ethernal");
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .then(() => {
    // eslint-disable-next-line
    process.exit(0);
  });
