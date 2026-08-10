// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OpenBellTestUSDG
/// @notice Testnet-only fixture. This token is not USDG and has no financial value.
contract OpenBellTestUSDG is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;

    mapping(address account => bool claimed) public hasClaimed;

    error AlreadyClaimed();

    constructor() ERC20("OpenBell Test USDG (Fixture)", "tUSDG") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claimFixtureTokens() external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
