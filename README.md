# CryptoCookies - Crypto options trading application

## Overview

CryptoCookies aims to bring crypto options trading to the masses by simplifying a currently complex domain and allowing
novice traders to get involved in an easy to understand and fun way.

Buyers choose one of three 'Cookies' which represent a distance from the current market and allow them to
trade off the payout percentage vs the likelihood of that price level being reached (or not reached).

## Components

* Solidity smart contract for holding deal investment until expiry and paying out
  winnings. Uses OpenZepppelin and Hardhat frameworks
* React front end application for viewing current Cookie prices, initiating deals and
  viewing deal history
* Back end application to provide APIs for the front end, admin functions to
  CryptoCookies staff  and trigger the settlement of expired deals

## Order/Settlement Process

* A user opens https://cryptocookies.com/app
* The select a pair (e.g. BTC/USD), a Cookie type (which adjusts the target price), the direction (higher or lower than
  current price),
  and whether the think it will or will not expiry at that price.
* They enter an investment amount and are shown the amount they will receive if the price reaches the target at expiry.
* If they wish to proceed, they connect a wallet to the site and authorise the token spend to deposit the investment
  amount.
* The site calls fundDeal on our contract which performs a token transfer from the user to the contract.
* The backend application listens for fundDeal events and either confirms or rejects the deal. If a deal is rejected,
  the tokens
  are returned to the sender. Deals may be rejected if they refer to invalid prices or breach min/max investment amount
  validation.
* Once confirmed, the contract holds the tokens until expiry at which point the tokens plus profit are paid out if the
  price level was reached
* The backend application runs a regular job to check for expired deals and trigger settlement. It does this off-chain
  due to
  the need to look up the coin price at a very specific expiry time. The Deribit index price is used to determine if the
  deal wins or loses
  and the application calls settleDeals to mark deals as settled and payout any tokens owed. If the Deribit price is
  unavailable for any reason
  an average of 2 or more public prices is used (currently Kraken, Gemini, Coinbase and CoinMarketCap).
* Anytime before expiry, users may close a deal if a close price is available via the frontend application. Clicking
  close
  sends a requestClose transaction to the contract. The backend application listens for close requests, checks the
  requested close
  price is valid and processes the close request by calling the closeDeal function. This triggers the payout of tokens
  to the user
  based on the close price. An invalid close request can be rejected by the backend application via the rejectClose
  function.
* Deal operations like confirm/reject/close are protected by the DEALER_ROLE which will be granted to the address used
  by
  the backend application.

## Treasury Functions

* Initially, CryptoCookies will deposit settlement tokens to each contract to pay out on winning deals. Tokens are
  deposited via
  the depositSettlement function. The contract also provides admin functions for registering new deposit tokens and
  updating token contract
  addresses if needed (registerToken/reregisterToken)
* As users trade with the application, tokens from losing deals build up in the contract and can be withdrawn via the
  withdrawSettlement function. This (and other treasury functions) are protected by the TREASURY_ROLE. The contract
  enforces
  a minimum settlement balance for each token based on the currently open deals. The worst case payout is calculated
  based on
  the coin price being zero and infinity. This worst case payout is then multiplied by a constant (initially 10 times)
  to calculate
  the minimum balance. Calls to withdrawSettlement will fail if it would breach this minimum amount.
* The backend application will reject deals if they would cause a breach of these minimum settlement limits. To allow
  some headroom
  for CryptoCookies to transfer funds between chains/tokens, the application converts all balances/deals across all
  chains to USD
  before
  checking if the deal can be accepted within the 10 x \<worst case payout> limit.
* The front end application includes a Treasury page displaying these balances and limits on each supported chain so
  that they can have confidence that there is always sufficient funds to pay winning deals.
* The payout functionality may be paused by the contract administrator in order to address a security issue or
  contract/off-chain system bug. It will be resumed once it is deemed safe to do so by administrators

## Pricing

* Prices are published to the application by a separate pricing system using a RabbitMQ messaging server. These
  prices are forwarded onto the front end using websockets and the REST API.
