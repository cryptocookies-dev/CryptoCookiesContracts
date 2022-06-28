import hre, { defender, ethers } from "hardhat";
import fs from "fs";

async function main() {
  const address = fs.readFileSync(
    `./build/cookieHolderProxyAddress-${hre.hardhatArguments.network}.txt`,
    "utf8"
  );

  const configProp = `GNOSIS_SAFE_ADDRESS_${hre.hardhatArguments.network?.toUpperCase()}`;
  const multiSigAddress = process.env[configProp];

  if (!multiSigAddress) {
    throw new Error(` ${configProp} must be set`);
  }

  const CookieHolder = await ethers.getContractFactory("CookieHolder");
  console.log(`Preparing proposal to upgrade CookieHolder at ${address}...`);
  return await defender.proposeUpgrade(address, CookieHolder, {
    title: "Cookie Holder contract upgrade",
    multisig: multiSigAddress,
    multisigType: "Gnosis Safe",
    kind: "uups",
  });
}

main()
  .then((propsal) => console.log("Upgrade proposal created at:", propsal.url))
  .catch((err) => {
    console.error(err);
  });
