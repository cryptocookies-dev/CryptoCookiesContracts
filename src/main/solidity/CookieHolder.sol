// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";

/// @title  CryptoCookies deal management contract
/// @notice This contract holds CryptoCookies deal details and funds deposited until expired deals are settled by
//          the off-chain system.
contract CookieHolder is
Initializable,
AccessControlEnumerableUpgradeable,
UUPSUpgradeable,
PausableUpgradeable
{
    using SafeERC20Upgradeable for IERC20MetadataUpgradeable;

    struct TokenBalance {
        string token;
        uint256 balance;
        uint256 settlement;
        uint256 open;
        uint256 minSettlement;
        address tokenContract;
    }

    struct Deal {
        uint256 payout;
        uint256 investment;
        bytes32 tokenHash;
        Side side;
        Status status;
        OptionType optionType;
    }

    struct DealAndOwner {
        uint256 dealId;
        address owner;
    }

    enum Status {
        UNKNOWN,
        PENDING,
        CONFIRMED,
        WON,
        LOST,
        PENDING_CLOSE,
        CLOSED,
        REJECTED
    }

    enum Side {
        BUY,
        SELL
    }

    enum OptionType {
        PUT,
        CALL
    }

    // confirm,reject,close,settle
    bytes32 public constant DEALER_ROLE = keccak256("DEALER_ROLE");
    // deposit/withdraw from settlement
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    // Registered token hashes
    bytes32[] private tokens;
    // Token hash -> symbol;
    mapping(bytes32 => string) private tokenSymbols;
    // Token hash -> settlement balance
    mapping(bytes32 => uint256) private settlementBalances;
    // Token hash -> open deal balance
    mapping(bytes32 => uint256) private openDealBalances;
    // Token hash -> contract
    mapping(bytes32 => IERC20MetadataUpgradeable) private tokenContracts;
    // Sender address  -> deal counter
    mapping(address => uint256) private dealIdCounter;
    // Sender address  -> deal ID -> deal state
    mapping(address => mapping(uint256 => Deal)) private dealMap;
    // Token hash -> total payout if price was zero
    mapping(bytes32 => uint256) private totalPayoutAtZero;
    // Token hash -> total payout if price was infinite
    mapping(bytes32 => uint256) private totalPayoutAtInf;

    uint8 private constant MIN_BALANCE_MULTIPLIER = 10;

    event NewDeal(
        address indexed owner,
        uint256 dealId,
        string contractName,
        uint256 investment,
        uint256 priceId,
        uint256 createdAt,
        Side side,
        string token
    );
    event ConfirmedDeal(address indexed owner, uint256 indexed dealId, uint256 payout);
    event CloseRejected(address indexed owner, uint256 indexed dealId, string reason);
    event RejectedDeal(address indexed owner, uint256 indexed dealId, string reason);
    event CloseRequested(address indexed owner, uint256 indexed dealId, uint256 priceId);
    event SettledDeal(address indexed owner, uint256 indexed dealId, uint256 payout, bool won);
    event ClosedDeal(address indexed owner, uint256 indexed dealId, uint256 payout);

    /// @notice Initialises the contract with a list of deposit tokens and their contract addresses
    /// @dev Initialises upgradeable, access control and pausable. All roles granted to msg.sender initially
    /// @param _tokens list of token symbols e.g. [USDC, WETH...]
    /// @param _tokenContracts the contract address for each token in the _tokens list
    function initialize(string[] calldata _tokens, address[] calldata _tokenContracts)
    external
    initializer
    {
        __AccessControlEnumerable_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEALER_ROLE, msg.sender);
        _grantRole(TREASURY_ROLE, msg.sender);

        uint256 tokenLength = _tokens.length;
        for (uint256 i = 0; i < tokenLength; i++) {
            registerToken(_tokens[i], _tokenContracts[i]);
        }
    }

    /// @notice Updates the contract address for a given token
    /// @param token the token symbol, must have been previsously registered via registerToken
    /// @param newTokenAddress the new token contract address
    function reregisterToken(string calldata token, address newTokenAddress)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
    {
        bytes32 newTokenHash = keccak256(bytes(token));
        IERC20MetadataUpgradeable tokenContract = IERC20MetadataUpgradeable(newTokenAddress);
        string memory actualToken = tokenContract.symbol();
        require(
            _stringEquals(actualToken, token),
            string(abi.encodePacked(actualToken, " != ", token))
        );
        tokenContracts[newTokenHash] = tokenContract;
    }

    /// @notice Withdraws an amount from the settlement balance for a given token
    /// @dev Validates that we will not overdraw or breach the minimum balance limit
    /// @param destination the address to withdraw to
    /// @param token the token symbol to withdraw e.g. WETH
    /// @param amount the amount to withdraw
    function withdrawSettlement(
        address destination,
        string calldata token,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) whenNotPaused {
        bytes32 tokenHash = keccak256(bytes(token));

        uint256 atZero = totalPayoutAtZero[tokenHash];
        uint256 atInf = totalPayoutAtInf[tokenHash];
        uint256 worst = Math.max(atZero, atInf);
        uint256 minBalance = worst * MIN_BALANCE_MULTIPLIER;
        require(settlementBalances[tokenHash] - amount >= minBalance, "Min balance breach");
        _payoutFromSettlement(destination, tokenHash, amount);
    }

    /// @notice Recalculates the settlementBalances map to equal the amount not covered by openDealBalances. Only
    ///         expected to be used if unexpected token amounts are sent to the contract
    function recalcSettlementBalances() external onlyRole(TREASURY_ROLE) whenNotPaused {
        uint256 tokenLength = tokens.length;
        for (uint256 i = 0; i < tokenLength; i++) {
            bytes32 tokenHash = tokens[i];
            uint256 totalTokens = tokenContracts[tokenHash].balanceOf(address(this));
            if (openDealBalances[tokenHash] < totalTokens) {
                settlementBalances[tokenHash] = uint256(totalTokens - openDealBalances[tokenHash]);
            } else {
                settlementBalances[tokenHash] = 0;
            }
        }
    }

    /// @notice Deposit and amount of token and update the settlement balance available for paying out winning deals
    /// @param token token symbol
    /// @param amount amount of token to deposit (from msg.sender)
    function depositSettlement(string calldata token, uint256 amount)
    external
    onlyRole(TREASURY_ROLE)
    whenNotPaused
    {
        bytes32 tokenHash = keccak256(bytes(token));
        _receiveTokens(msg.sender, tokenHash, amount);
        _claimForSettlement(tokenHash, amount);
    }

    /// @notice Claim an amount of token already owned by the contract and update the settlement balance available for paying out winning deals
    /// @param token token symbol
    /// @param amount amount of token to deposit (from msg.sender)
    function depositSettlementFromExisting(string calldata token, uint256 amount)
    external
    onlyRole(TREASURY_ROLE)
    whenNotPaused
    {
        bytes32 tokenHash = keccak256(bytes(token));
        _claimForSettlement(tokenHash, amount);
    }

    /// @notice Creates a new deal
    /// @param contractName the name of the contract e.g. FORTUNE-BTC/USD-21JUN22-23750-C
    /// @param priceId the ID of the price you want to deal on
    /// @param side BUY or SELL
    /// @param createdAt time the transaction was sent (epoch milliseconds)
    /// @param token the token symbol to deposit e.g. WETH
    /// @param investment the amount of token to deposit
    function fundDeal(
        string calldata contractName,
        uint256 priceId,
        Side side,
        uint256 createdAt,
        string calldata token,
        uint256 investment
    ) external whenNotPaused {
        uint256 dealId = dealIdCounter[msg.sender] + 1;
        dealIdCounter[msg.sender] = dealId;

        Deal storage deal = dealMap[msg.sender][dealId];
        deal.status = Status.PENDING;
        deal.side = side;
        deal.investment = investment;
        deal.tokenHash = keccak256(bytes(token));

        emit NewDeal(msg.sender, dealId, contractName, investment, priceId, createdAt, side, token);

        openDealBalances[deal.tokenHash] += investment;
        _receiveTokens(msg.sender, deal.tokenHash, investment);
    }

    /// @notice Called by the off-chain system to confirm that a deal created via fundDeal is valid and will be paid on expiry
    /// @param owner address of the deal owner
    /// @param dealId ID of the deal to confirm
    /// @param payoutAmount confirmed payout amount if the deal wins
    /// @param optionType the option type of the deal contract PUT or CALL
    function confirmDeal(
        address owner,
        uint256 dealId,
        uint256 payoutAmount,
        OptionType optionType
    ) external onlyRole(DEALER_ROLE) whenNotPaused {
        Deal storage deal = _assertDealStatus(owner, dealId, Status.PENDING, "Expected PENDING");

        deal.payout = payoutAmount;
        deal.status = Status.CONFIRMED;
        deal.optionType = optionType;

        _increaseTotalPayoutCalcs(deal);

        emit ConfirmedDeal(owner, dealId, payoutAmount);
    }

    /// @notice Settles a batch of winning and losing deals - called by the off-chain system after contract expiry date
    /// @param winningDeals deals to payout
    /// @param losingDeals deals to claim investment to settlement
    function settleDeals(DealAndOwner[] calldata winningDeals, DealAndOwner[] calldata losingDeals)
    external
    onlyRole(DEALER_ROLE)
    whenNotPaused
    {
        uint256 losingDealsLength = losingDeals.length;
        // Losing first so contract has maximal settlement balance for paying winning
        for (uint256 i = 0; i < losingDealsLength; i++) {
            DealAndOwner calldata dealAndOwner = losingDeals[i];

            //Skip empty array placeholder deals
            if (dealAndOwner.owner == address(0) || dealAndOwner.dealId == 0) continue;
            if (dealMap[dealAndOwner.owner][dealAndOwner.dealId].status != Status.CONFIRMED)
                continue;

            Deal storage deal = dealMap[dealAndOwner.owner][dealAndOwner.dealId];
            deal.status = Status.LOST;
            openDealBalances[deal.tokenHash] -= deal.investment;
            _claimForSettlement(deal.tokenHash, deal.investment);
            _decreaseTotalPayoutCalcs(deal);

            emit SettledDeal(dealAndOwner.owner, dealAndOwner.dealId, 0, false);
        }

        uint256 winningDealsLength = winningDeals.length;
        for (uint256 i = 0; i < winningDealsLength; i++) {
            DealAndOwner calldata dealAndOwner = winningDeals[i];

            //Skip empty array placeholder deals
            if (dealAndOwner.owner == address(0) || dealAndOwner.dealId == 0) continue;
            if (dealMap[dealAndOwner.owner][dealAndOwner.dealId].status != Status.CONFIRMED)
                continue;

            Deal storage deal = dealMap[dealAndOwner.owner][dealAndOwner.dealId];

            // Try other deals in case we have enough settlement
            if (settlementBalances[deal.tokenHash] < deal.payout) continue;

            deal.status = Status.WON;
            openDealBalances[deal.tokenHash] -= deal.investment;

            //Claim original investment then send back as part of payout
            _claimForSettlement(deal.tokenHash, deal.investment);
            _decreaseTotalPayoutCalcs(deal);

            emit SettledDeal(dealAndOwner.owner, dealAndOwner.dealId, deal.payout, true);

            _payoutFromSettlement(dealAndOwner.owner, deal.tokenHash, deal.payout);
        }
    }

    /// @notice Rejects an invalid deal - called by the off-chain system
    /// @param owner address of deal owner
    /// @param dealId ID of deal
    /// @param reason deal rejection reason
    function rejectDeal(
        address owner,
        uint256 dealId,
        string calldata reason
    ) external onlyRole(DEALER_ROLE) whenNotPaused {
        Status[] memory expected = new Status[](2);
        expected[0] = Status.PENDING;
        expected[1] = Status.CONFIRMED;

        Deal storage deal = _assertDealStatusIn(
            owner,
            dealId,
            expected,
            "Expected PENDING or CONFIRMED"
        );

        IERC20MetadataUpgradeable tokenContract = tokenContracts[deal.tokenHash];

        require(
            tokenContract.balanceOf(address(this)) >= deal.investment,
            "Insufficient funds to return investment"
        );

        if (deal.status == Status.CONFIRMED) {
            _decreaseTotalPayoutCalcs(deal);
        }

        deal.status = Status.REJECTED;

        emit RejectedDeal(owner, dealId, reason);

        openDealBalances[deal.tokenHash] -= deal.investment;

        _sendTokens(owner, deal.tokenHash, deal.investment);
    }

    /// @notice Request for a deal to be closed at the given price
    /// @param dealId the ID of the deal to close
    /// @param priceId the closing price
    function requestClose(uint256 dealId, uint256 priceId) external whenNotPaused {
        Deal storage deal = _assertDealStatus(
            msg.sender,
            dealId,
            Status.CONFIRMED,
            "Expected CONFIRMED"
        );

        deal.status = Status.PENDING_CLOSE;

        emit CloseRequested(msg.sender, dealId, priceId);
    }

    /// @notice Reject a close request - called by the off-chain system
    /// @param owner address of deal owner
    /// @param dealId ID of deal
    /// @param reason deal rejection reason
    function rejectClose(
        address owner,
        uint256 dealId,
        string calldata reason
    ) external onlyRole(DEALER_ROLE) whenNotPaused {
        Deal storage deal = _assertDealStatus(
            owner,
            dealId,
            Status.PENDING_CLOSE,
            "Expected PENDING_CLOSE"
        );

        deal.status = Status.CONFIRMED;

        emit CloseRejected(owner, dealId, reason);
    }

    /// @notice Closes a deal requeted via requestClose  - called by the off-chain system
    /// @param owner address of deal owner
    /// @param dealId ID of deal
    /// @param closePayout the payout calculated from close priceId
    function closeDeal(
        address owner,
        uint256 dealId,
        uint256 closePayout
    ) external onlyRole(DEALER_ROLE) whenNotPaused {
        Deal storage deal = _assertDealStatus(
            owner,
            dealId,
            Status.PENDING_CLOSE,
            "Expected PENDING_CLOSE"
        );

        deal.status = Status.CLOSED;

        emit ClosedDeal(owner, dealId, closePayout);

        _claimForSettlement(deal.tokenHash, deal.investment);
        openDealBalances[deal.tokenHash] -= deal.investment;
        _decreaseTotalPayoutCalcs(deal);
        _payoutFromSettlement(owner, deal.tokenHash, closePayout);
    }

    /// @notice pauses payout functionality in case of security issue or code bug
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        _pause();
    }

    /// @notice resume payout functionality
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        _unpause();
    }

    /// @notice Returns a list of registered tokens and their balances (open, settlement, total and minimum)
    function getBalances() external view returns (TokenBalance[] memory) {
        uint256 tokenLength = tokens.length;
        TokenBalance[] memory balances = new TokenBalance[](tokenLength);
        for (uint256 i = 0; i < tokenLength; i++) {
            bytes32 tokenHash = tokens[i];
            balances[i] = TokenBalance(
                tokenSymbols[tokenHash],
                tokenContracts[tokenHash].balanceOf(address(this)),
                settlementBalances[tokenHash],
                openDealBalances[tokenHash],
                Math.max(totalPayoutAtZero[tokenHash], totalPayoutAtInf[tokenHash]) *
                MIN_BALANCE_MULTIPLIER,
                address(tokenContracts[tokens[i]])
            );
        }
        return balances;
    }

    /// @notice Returns the current Status of a deal
    function getDealStatus(address owner, uint256 dealId) external view returns (Status) {
        return dealMap[owner][dealId].status;
    }

    /// @notice Add a new token to the list of accepted deposit tokens
    /// @param newToken new token symbol e.g WBTC
    /// @param newTokenAddress the contract address of the new token
    function registerToken(string calldata newToken, address newTokenAddress)
    public
    onlyRole(DEALER_ROLE)
    {
        bytes32 newTokenHash = keccak256(bytes(newToken));
        uint256 tokenLength = tokens.length;
        for (uint256 i = 0; i < tokenLength; i++) {
            require(tokens[i] != newTokenHash, string(abi.encodePacked("Dupe ", newToken)));
        }
        IERC20MetadataUpgradeable tokenContract = IERC20MetadataUpgradeable(newTokenAddress);
        string memory actualToken = tokenContract.symbol();
        require(
            _stringEquals(actualToken, newToken),
            string(abi.encodePacked(actualToken, " != ", newToken))
        );
        tokenContracts[newTokenHash] = tokenContract;
        tokenSymbols[newTokenHash] = actualToken;
        tokens.push(newTokenHash);
    }

    /// @notice Internal function to perform token transfer and reduce settlement balance
    function _payoutFromSettlement(
        address destination,
        bytes32 tokenHash,
        uint256 amount
    ) internal {
        require(settlementBalances[tokenHash] >= amount, "Insufficient settlement");

        settlementBalances[tokenHash] = settlementBalances[tokenHash] - amount;

        _sendTokens(destination, tokenHash, amount);
    }

    /// @notice Add an amount tot he settlement balance for a token
    function _claimForSettlement(bytes32 tokenHash, uint256 amount) internal {
        settlementBalances[tokenHash] += amount;
    }

    /// @notice Transfers token amount from the sender to the contract
    function _receiveTokens(
        address from,
        bytes32 tokenHash,
        uint256 amount
    ) internal {
        IERC20MetadataUpgradeable tokenContract = tokenContracts[tokenHash];
        tokenContract.safeTransferFrom(from, address(this), amount);
    }

    /// @notice Sends tokens from the contract to an address after incrementing allowance
    function _sendTokens(
        address destination,
        bytes32 tokenHash,
        uint256 amount
    ) internal {
        IERC20MetadataUpgradeable tokenContract = tokenContracts[tokenHash];
        tokenContract.safeIncreaseAllowance(destination, amount);
        tokenContract.safeTransfer(destination, amount);
    }

    /// @notice Requires DEFAULT_ADMIN_ROLE to be able to upgrade contract
    function _authorizeUpgrade(address newImplementation)
    internal
    override
    onlyRole(DEFAULT_ADMIN_ROLE)
    {}

    /// @notice Updates the worst payout calculations given a new confirmed deal.
    ///         BUY CALL and SELL PUT payout at Inf
    ///         SELL CALL and BUY PUT payout at zero
    function _increaseTotalPayoutCalcs(Deal storage deal) internal {
        if (deal.side == Side.BUY) {
            if (deal.optionType == OptionType.CALL) {
                totalPayoutAtInf[deal.tokenHash] += deal.payout;
            } else {
                totalPayoutAtZero[deal.tokenHash] += deal.payout;
            }
        } else {
            if (deal.optionType == OptionType.CALL) {
                totalPayoutAtZero[deal.tokenHash] += deal.payout;
            } else {
                totalPayoutAtInf[deal.tokenHash] += deal.payout;
            }
        }
    }

    /// @notice Inverse of _increaseTotalPayoutCalcs, reduces payout calculations when Deal expires
    function _decreaseTotalPayoutCalcs(Deal storage deal) internal {
        if (deal.side == Side.BUY) {
            if (deal.optionType == OptionType.CALL) {
                totalPayoutAtInf[deal.tokenHash] -= deal.payout;
            } else {
                totalPayoutAtZero[deal.tokenHash] -= deal.payout;
            }
        } else {
            if (deal.optionType == OptionType.CALL) {
                totalPayoutAtZero[deal.tokenHash] -= deal.payout;
            } else {
                totalPayoutAtInf[deal.tokenHash] -= deal.payout;
            }
        }
    }

    /// @notice Validates that the given deal has one of the expected status
    function _assertDealStatusIn(
        address owner,
        uint256 dealId,
        Status[] memory expectedStatus,
        string memory error
    ) internal view returns (Deal storage) {
        Deal storage deal = dealMap[owner][dealId];
        Status status = deal.status;
        for (uint256 i = 0; i < expectedStatus.length; i++) {
            Status expected = expectedStatus[i];
            if (status == expected) {
                return deal;
            }
        }

        revert(
        string(
            abi.encodePacked(
                Strings.toHexString(uint256(uint160(owner)), 20),
                ":",
                Strings.toString(dealId),
                " incorrect status: ",
                Strings.toString(uint256(dealMap[owner][dealId].status)),
                " ",
                error
            )
        )
        );
    }

    /// @notice Validates that the given deal has the expected status
    function _assertDealStatus(
        address owner,
        uint256 dealId,
        Status expectedStatus,
        string memory error
    ) internal view returns (Deal storage) {
        Deal storage deal = dealMap[owner][dealId];
        if (deal.status != expectedStatus) {
            revert(
            string(
                abi.encodePacked(
                    Strings.toHexString(uint256(uint160(owner)), 20),
                    ":",
                    Strings.toString(dealId),
                    " incorrect status: ",
                    Strings.toString(uint256(dealMap[owner][dealId].status)),
                    " ",
                    error
                )
            )
            );
        }
        return deal;
    }

    function _stringEquals(string memory a, string memory b) internal pure returns (bool) {
        return bytes(a).length == bytes(b).length && keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
