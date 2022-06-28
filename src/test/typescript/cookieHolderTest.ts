import { expect, use } from "chai";
import { ethers, upgrades } from "hardhat";
import { describe } from "mocha";
import { parseEther } from "ethers/lib/utils";
import { CookieHolder, ERC20PresetFixedSupply, } from "../../../build/generated/sources/hardhat/main/typescript";
import chaiAsPromised from "chai-as-promised";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

use(chaiAsPromised);

describe("CookieHolder", function () {
  let cookieHolder: CookieHolder;
  let deployedWeth: ERC20PresetFixedSupply;
  let deployedWbtc: ERC20PresetFixedSupply;
  let deployedWbtc2: ERC20PresetFixedSupply;

  before(async function () {
    const [owner] = await ethers.getSigners();
    const dummyWeth = await ethers.getContractFactory("ERC20PresetFixedSupply");
    deployedWeth = await dummyWeth.deploy(
      "Wrapped ETH",
      "WETH",
      10000000000,
      owner.address
    );
    deployedWbtc = await dummyWeth.deploy(
      "Wrapped BTC",
      "WBTC",
      10000000000,
      owner.address
    );
    deployedWbtc2 = await dummyWeth.deploy(
      "Wrapped BTC 2",
      "WBTC",
      10000000000,
      owner.address
    );
  });

  beforeEach(async function () {
    const contract = await ethers.getContractFactory("CookieHolder");
    const deployed = await upgrades.deployProxy(contract, [
      ["WETH"],
      [deployedWeth.address],
    ]);

    cookieHolder = <CookieHolder>deployed;
  });

  async function fundDeal(
    depositor: SignerWithAddress,
    investment: number,
    expectedDealId: number = 1,
    token: string = "WETH"
  ) {
    await deployedWeth.transfer(depositor.address, investment);
    await deployedWeth
      .connect(depositor)
      .approve(cookieHolder.address, investment);

    const created = new Date().getTime();
    await expect(
      cookieHolder
        .connect(depositor)
        .fundDeal("foo", 1, 0, created, token, investment)
    )
      .to.emit(cookieHolder, "NewDeal")
      .withArgs(
        depositor.address,
        expectedDealId,
        "foo",
        investment,
        1,
        created,
        0,
        token
      );
  }

  async function depositSettlement(
    investment: number,
    contract = deployedWeth,
    token = "WETH"
  ) {
    await contract.approve(cookieHolder.address, investment);
    await cookieHolder.depositSettlement(token, investment);
  }

  it("Should allow registering payout tokens", async function () {
    expect(await cookieHolder.registerToken("WBTC", deployedWbtc.address)).to.be
      .not.null;
  });

  it("Should accept deal deposits", async function () {
    const [, addr1] = await ethers.getSigners();

    const investment = 1000;
    await fundDeal(addr1, investment);
  });

  async function confirmDeal(
    owner: SignerWithAddress,
    addr1: SignerWithAddress,
    dealId: number = 1,
    payout: number = 100
  ) {
    // Confirm as owner
    await expect(
      cookieHolder.connect(owner).confirmDeal(addr1.address, dealId, payout, 0)
    )
      .to.emit(cookieHolder, "ConfirmedDeal")
      .withArgs(addr1.address, dealId, payout);

    return dealId;
  }

  it("should be able to confirm a deal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 1000;

    await fundDeal(addr1, investment);
    await depositSettlement(investment);
    const dealId = await confirmDeal(owner, addr1);

    // re-confirm should fail
    await expect(
      cookieHolder.connect(owner).confirmDeal(addr1.address, dealId, 20000, 0)
    ).to.be.revertedWith(
      `${addr1.address.toLowerCase()}:1 incorrect status: 2 Expected PENDING`
    );
  });

  it("Should close one deal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const settlementDeposit = 5000;

    let settlement = (await cookieHolder.connect(owner).getBalances())[0]
      .settlement;
    expect(settlement).to.equal(parseEther("0"));

    await depositSettlement(settlementDeposit);

    const investment = 1000;
    const payout = 50;
    await fundDeal(addr1, investment);
    await confirmDeal(owner, addr1, 1, payout);

    await expect(cookieHolder.connect(addr1).requestClose(1, 1)).to.emit(
      cookieHolder,
      "CloseRequested"
    );

    const balance = await deployedWeth.balanceOf(addr1.address);

    await expect(
      cookieHolder.connect(owner).closeDeal(addr1.address, 1, payout)
    ).to.emit(cookieHolder, "ClosedDeal");

    settlement = (await cookieHolder.connect(owner).getBalances())[0]
      .settlement;
    expect(settlement).to.equal(settlementDeposit + investment - payout);

    const updatedBalance = await deployedWeth.balanceOf(addr1.address);
    const expectedBalance = balance.add(payout);

    expect(updatedBalance).to.equal(expectedBalance);
  });

  it("Should settle one winning deal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await fundDeal(addr1, investment, 1);
    const payout = 110;

    await depositSettlement(payout);

    await confirmDeal(owner, addr1, 1, payout);

    await depositSettlement(investment * 5);

    const winner = { owner: addr1.address, dealId: 1 };
    await expect(cookieHolder.connect(owner).settleDeals([winner], []))
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 1, payout, true);
  });

  it("Should settle multiple winning and losing deal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await depositSettlement(500);

    await fundDeal(addr1, investment, 1);
    const payout = 110;
    await confirmDeal(owner, addr1, 1, payout);

    const payout2 = 210;
    await fundDeal(addr1, investment, 2);
    await confirmDeal(owner, addr1, 2, payout2);

    await fundDeal(addr1, investment, 3);
    await confirmDeal(owner, addr1, 3, payout2);

    await depositSettlement(investment * 5);

    await expect(
      cookieHolder.connect(owner).settleDeals(
        [
          { owner: addr1.address, dealId: 1 },
          { owner: addr1.address, dealId: 2 },
        ],
        [{ owner: addr1.address, dealId: 3 }]
      )
    )
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 1, payout, true)
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 2, payout2, true)
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 3, 0, false);
  });

  it("Should accept settlement deposits and update balance", async function () {
    let settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(1);
    expect(settlementBalances[0].settlement).to.equal(BigNumber.from(0));
    expect(settlementBalances[0].token).to.equal("WETH");

    await depositSettlement(1000);

    settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(1);
    expect(settlementBalances[0].settlement).to.equal(BigNumber.from(1000));
    expect(settlementBalances[0].token).to.equal("WETH");

    const balances = await cookieHolder.getBalances();
    expect(balances.length).to.equal(1);
    expect(balances[0].balance).to.equal(BigNumber.from(1000));
    expect(balances[0].token).to.equal("WETH");
  });

  it("Should load all token balances", async function () {
    const [owner] = await ethers.getSigners();

    let balances = await cookieHolder.getBalances();
    expect(balances.length).to.equal(1);
    expect(balances[0].balance).to.equal(BigNumber.from(0));
    expect(balances[0].token).to.equal("WETH");

    await cookieHolder.registerToken("WBTC", deployedWbtc.address);

    await deployedWbtc.approve(owner.address, 1000);
    await deployedWbtc.transferFrom(owner.address, cookieHolder.address, 1000);

    balances = await cookieHolder.getBalances();
    expect(balances.length).to.equal(2);
    expect(balances[1].token).to.equal("WBTC");
    expect(balances[1].balance).to.equal(BigNumber.from(1000));
  });

  it("Should track open deal balances", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await depositSettlement(500);

    await fundDeal(addr1, investment, 1);

    let openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(BigNumber.from(investment));

    const payout = 110;
    await confirmDeal(owner, addr1, 1, payout);

    const payout2 = 210;
    await fundDeal(addr1, investment, 2);

    // 1 & 2 Open
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(
      BigNumber.from(investment + investment)
    );
    await cookieHolder.rejectDeal(addr1.address, 2, "rejected");

    // Only 1 Open
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(BigNumber.from(investment));

    await fundDeal(addr1, investment, 3);
    await confirmDeal(owner, addr1, 3, payout2);

    // 1 & 3 Open
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(
      BigNumber.from(investment + investment)
    );

    await cookieHolder.settleDeals(
      [{ owner: addr1.address, dealId: 1 }],
      [{ owner: addr1.address, dealId: 3 }]
    );

    // all closed
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(BigNumber.from(0));

    const investment4 = 999;
    await fundDeal(addr1, investment4, 4);
    await confirmDeal(owner, addr1, 4, payout2);

    // 4 open
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(BigNumber.from(investment4));

    await cookieHolder.connect(addr1).requestClose(4, 1);
    await cookieHolder.closeDeal(addr1.address, 4, 50);

    // all closed
    openBalances = await cookieHolder.getBalances();
    expect(openBalances.length).to.equal(1);
    expect(openBalances[0].token).to.equal("WETH");
    expect(openBalances[0].open).to.equal(BigNumber.from(0));
  });

  it("Should be able to reject close", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 999;
    const payout = 1999;
    await fundDeal(addr1, investment, 1);
    await confirmDeal(owner, addr1, 1, payout);
    await cookieHolder.connect(addr1).requestClose(1, 1);
    await expect(cookieHolder.rejectClose(addr1.address, 1, "bad reject"))
      .to.emit(cookieHolder, "CloseRejected")
      .withArgs(addr1.address, 1, "bad reject");

    await expect(cookieHolder.connect(addr1).requestClose(1, 2)).to.emit(
      cookieHolder,
      "CloseRequested"
    );

    await expect(cookieHolder.closeDeal(addr1.address, 1, 50)).to.emit(
      cookieHolder,
      "ClosedDeal"
    );
  });

  it("Should reject withdrawal if deal not settled", async function () {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const investment = 100;

    await fundDeal(addr1, investment, 1);
    const payout = 110;
    await depositSettlement(payout);
    await confirmDeal(owner, addr1, 1, payout);

    await expect(
      cookieHolder.withdrawSettlement(addr2.address, "WETH", 210)
    ).to.be.revertedWith("");

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([], [{ owner: addr1.address, dealId: 1 }])
    )
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 1, 0, false);

    expect(() =>
      cookieHolder.withdrawSettlement(addr2.address, "WETH", 50)
    ).changeTokenBalance(deployedWeth, addr2, 50);
  });

  it("Should register token contract", async function () {
    await cookieHolder.registerToken("WBTC", deployedWbtc.address);
    await cookieHolder.reregisterToken("WBTC", deployedWbtc2.address);
    await expect(
      cookieHolder.registerToken("FOO", deployedWeth.address)
    ).to.revertedWith("");

    const balances = await cookieHolder.getBalances();
    expect(balances[1]?.tokenContract).to.equal(deployedWbtc2.address);
  });

  it("Should skip already settled deals", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await depositSettlement(500);

    await fundDeal(addr1, investment, 1);
    const payout = 110;
    await confirmDeal(owner, addr1, 1, payout);

    const payout2 = 210;
    await fundDeal(addr1, investment, 2);
    await confirmDeal(owner, addr1, 2, payout2);

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals(
          [{ owner: addr1.address, dealId: 1 }],
          [{ owner: addr1.address, dealId: 2 }]
        )
    )
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 1, payout, true)
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 2, 0, false);

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([{ owner: addr1.address, dealId: 1 }], [])
    ).to.not.emit(cookieHolder, "SettledDeal");

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([{ owner: addr1.address, dealId: 2 }], [])
    ).to.not.emit(cookieHolder, "SettledDeal");
  });

  it("Should recalc settlement", async function () {
    const [owner, addr1] = await ethers.getSigners();

    await cookieHolder.registerToken("WBTC", deployedWbtc.address);

    await depositSettlement(500, deployedWbtc, "WBTC");

    await fundDeal(addr1, 100, 1);
    const payout = 110;
    await confirmDeal(owner, addr1, 1, payout);

    let settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(2);
    expect(settlementBalances[1].settlement).to.equal(BigNumber.from(500));
    expect(settlementBalances[1].token).to.equal("WBTC");

    await expect(
      cookieHolder.recalcSettlementBalances()
    ).to.not.be.revertedWith("");

    settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(2);
    expect(settlementBalances[1].settlement).to.equal(BigNumber.from(500));
    expect(settlementBalances[1].token).to.equal("WBTC");

    await cookieHolder.reregisterToken("WBTC", deployedWbtc2.address);

    await expect(
      cookieHolder.recalcSettlementBalances()
    ).to.not.be.revertedWith("");

    // Recalc should correct it to zero
    settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(2);
    expect(settlementBalances[1].settlement).to.equal(BigNumber.from(0));
    expect(settlementBalances[1].token).to.equal("WBTC");

    await cookieHolder.reregisterToken("WBTC", deployedWbtc.address);

    await expect(
      cookieHolder.recalcSettlementBalances()
    ).to.not.be.revertedWith("");

    // Recalc should correct it back 500
    settlementBalances = await cookieHolder.getBalances();
    expect(settlementBalances.length).to.equal(2);
    expect(settlementBalances[1].settlement).to.equal(BigNumber.from(500));
    expect(settlementBalances[1].token).to.equal("WBTC");
  });

  it("Should be able to reject pending or confirmed deal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await depositSettlement(150);

    await fundDeal(addr1, investment, 1);

    await expect(
      cookieHolder.rejectDeal(addr1.address, 1, "reject pending")
    ).to.emit(cookieHolder, "RejectedDeal");

    await fundDeal(addr1, investment, 2);

    const payout = 110;
    await confirmDeal(owner, addr1, 2, payout);

    await expect(
      cookieHolder.rejectDeal(addr1.address, 2, "reject confirmed")
    ).to.emit(cookieHolder, "RejectedDeal");

    await fundDeal(addr1, investment, 3);

    await confirmDeal(owner, addr1, 3, payout);

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([], [{ owner: addr1.address, dealId: 3 }])
    ).to.emit(cookieHolder, "SettledDeal");

    await expect(
      cookieHolder.rejectDeal(addr1.address, 3, "reject settled")
    ).to.be.revertedWith(
      `${addr1.address.toLowerCase()}:3 incorrect status: 4 Expected PENDING or CONFIRMED`
    );
  });

  it("Should skip settlement if insufficient bal", async function () {
    const [owner, addr1] = await ethers.getSigners();

    const investment = 100;

    await depositSettlement(150);

    await fundDeal(addr1, investment, 1);
    const payout = 110;
    await confirmDeal(owner, addr1, 1, payout);

    const payout2 = 210;
    await fundDeal(addr1, investment, 2);
    await confirmDeal(owner, addr1, 2, payout2);

    await expect(
      cookieHolder.connect(owner).settleDeals(
        [
          { owner: addr1.address, dealId: 1 },
          { owner: addr1.address, dealId: 2 },
        ],
        []
      )
    )
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 1, payout, true);

    await depositSettlement(250);

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([{ owner: addr1.address, dealId: 2 }], [])
    )
      .to.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 2, payout2, true);

    await expect(
      cookieHolder
        .connect(owner)
        .settleDeals([{ owner: addr1.address, dealId: 2 }], [])
    )
      .to.not.emit(cookieHolder, "SettledDeal")
      .withArgs(addr1.address, 2, payout2, true);
  });

  it("Should pause and unpause", async function () {
    await expect(cookieHolder.pause());

    await expect(cookieHolder.recalcSettlementBalances()).to.be.revertedWith(
      "Pausable: paused"
    );

    await expect(cookieHolder.unpause());
  });
  // FIXME can't close deal multiple times
  //     must have treasury role to withdraw/deposit
  //     must have dealer role to confirm/reject/close
  //     min deposit logic
});
