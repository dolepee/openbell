// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DeployOpenBellFixtureTestnet } from "../script/DeployFixtureTestnet.s.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";
import { OpenBellTestUSDG } from "../src/mocks/OpenBellTestUSDG.sol";

contract DeployOpenBellFixtureTestnetScriptTest is Test {
    address internal constant DEPLOYER = address(0xD3F10);
    address internal constant OWNER = address(0xA11CE);
    address internal constant UNDERWRITER = address(0xB0B);

    DeployOpenBellFixtureTestnet internal script;

    function setUp() public {
        script = new DeployOpenBellFixtureTestnet();
    }

    function test_RevertsOnWrongChainBeforeDeployment() public {
        vm.chainId(196);
        vm.expectRevert(
            abi.encodeWithSelector(DeployOpenBellFixtureTestnet.WrongChain.selector, uint256(196))
        );
        script.deployFixture(DEPLOYER, OWNER, UNDERWRITER);
    }

    function test_RevertsOnZeroOrCollapsedRoles() public {
        vm.chainId(1952);

        vm.expectRevert(DeployOpenBellFixtureTestnet.ZeroRole.selector);
        script.deployFixture(address(0), OWNER, UNDERWRITER);

        vm.expectRevert(DeployOpenBellFixtureTestnet.ZeroRole.selector);
        script.deployFixture(DEPLOYER, address(0), UNDERWRITER);

        vm.expectRevert(DeployOpenBellFixtureTestnet.ZeroRole.selector);
        script.deployFixture(DEPLOYER, OWNER, address(0));

        vm.expectRevert(DeployOpenBellFixtureTestnet.SameOwnerAndUnderwriter.selector);
        script.deployFixture(DEPLOYER, OWNER, OWNER);
    }

    function test_DeploysExactlyTwoCreatesFromExplicitDeployerAndSealsConfiguration() public {
        vm.chainId(1952);
        uint64 startingNonce = vm.getNonce(DEPLOYER);
        address expectedFixture = vm.computeCreateAddress(DEPLOYER, startingNonce);
        address expectedOpenBell = vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 1);

        (OpenBellTestUSDG fixtureSettlement, OpenBellReceivables openBell) =
            script.deployFixture(DEPLOYER, OWNER, UNDERWRITER);

        assertEq(address(fixtureSettlement), expectedFixture, "fixture CREATE address");
        assertEq(address(openBell), expectedOpenBell, "receivables CREATE address");
        assertEq(vm.getNonce(DEPLOYER), startingNonce + 2, "exactly two CREATEs");
        assertGt(address(fixtureSettlement).code.length, 0, "fixture code");
        assertGt(address(openBell).code.length, 0, "receivables code");
        assertEq(fixtureSettlement.name(), "OpenBell Test USDG (Fixture)", "fixture name");
        assertEq(fixtureSettlement.symbol(), "tUSDG", "fixture symbol");
        assertEq(fixtureSettlement.decimals(), 6, "fixture decimals");
        assertEq(fixtureSettlement.FAUCET_AMOUNT(), 1_000e6, "fixture faucet amount");
        assertEq(fixtureSettlement.totalSupply(), 0, "zero initial fixture supply");
        assertEq(address(openBell.settlementToken()), address(fixtureSettlement), "settlement binding");
        assertEq(openBell.owner(), OWNER, "owner");
        assertEq(openBell.pendingOwner(), address(0), "pending owner");
        assertEq(openBell.underwriter(), UNDERWRITER, "underwriter");
        assertFalse(openBell.paused(), "originations unpaused");
        assertEq(openBell.maxAdvanceBps(), 8_000, "advance cap");
        assertEq(openBell.maxFeeBps(), 2_000, "fee cap");
        assertEq(openBell.maxRiskAge(), 1 hours, "risk age");
        assertEq(openBell.maxInvoiceAge(), 7 days, "invoice age");
        assertEq(openBell.maxInvoiceTenor(), 90 days, "invoice tenor");

        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = openBell.eip712Domain();
        assertEq(fields, bytes1(0x0f), "domain fields");
        assertEq(name, "OpenBell Receivables", "domain name");
        assertEq(version, "1", "domain version");
        assertEq(chainId, 1952, "domain chain");
        assertEq(verifyingContract, address(openBell), "domain contract");
        assertEq(salt, bytes32(0), "domain salt");
        assertEq(extensions.length, 0, "domain extensions");
    }
}
