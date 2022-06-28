import { ethers, hardhatArguments, upgrades } from "hardhat";
import fs from "fs";

// FIXME convert to task so we can pass in tokens to register on construction
export async function deployCookieHolder() {
  const owner = (await ethers.getSigners())[0];

  const CookieHolder = await ethers.getContractFactory("CookieHolder", owner);
  const deployedCookieHolder = await upgrades.deployProxy(CookieHolder, [
    [],
    [],
  ]);

  console.log(
    "CookieHolder deployed to: " +
    deployedCookieHolder.address +
    " by " +
    owner.address
  );
  fs.writeFileSync(
    "./build/cookieHolderProxyAddress-" + hardhatArguments.network + ".txt",
    deployedCookieHolder.address
  );
  return deployedCookieHolder;
}
