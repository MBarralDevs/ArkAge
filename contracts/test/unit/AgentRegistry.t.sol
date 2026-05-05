// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {IACP} from "../../src/interfaces/IACP.sol";
import {MockIdentityRegistry} from "../mocks/MockIdentityRegistry.sol";
import {MockACP} from "../mocks/MockACP.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    MockIdentityRegistry idReg;
    MockACP acp;

    address owner = address(0xAAAA);
    address operator = address(0xBBBB);
    uint256 constant AGENT_ID = 42;

    function setUp() public {
        idReg = new MockIdentityRegistry();
        acp = new MockACP();
        registry = new AgentRegistry(address(idReg), address(acp));

        idReg.setOwner(AGENT_ID, owner);
    }

    function test_registerAgent_setsAllFields() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        IAgentRegistry.AgentInfo memory info = registry.agents(AGENT_ID);
        assertEq(info.operatorWallet, operator);
        assertEq(info.currentPolicyHash, policy);
        assertEq(info.perTxCap, 1_000_000);
        assertEq(info.evaluatorFeeMax, 100_000);
        assertTrue(info.active);
    }

    function test_registerAgent_revertsIfNotIdentityOwner() public {
        bytes32 policy = keccak256("policy-v1");
        vm.expectRevert(bytes("not identity owner"));
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);
    }

    function test_agentByOperator_lookupWorks() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        IAgentRegistry.AgentInfo memory info = registry.agentByOperator(operator);
        assertEq(info.operatorWallet, operator);
        assertEq(registry.agentIdByOperator(operator), AGENT_ID);
    }

    function test_updateOperator_changesMapping() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        address newOp = address(0xCCCC);
        vm.prank(owner);
        registry.updateOperator(AGENT_ID, newOp);

        assertEq(registry.agentIdByOperator(operator), 0);
        assertEq(registry.agentIdByOperator(newOp), AGENT_ID);
    }

    function test_deactivate_setsActiveFalse() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        vm.prank(owner);
        registry.deactivate(AGENT_ID);

        assertFalse(registry.agents(AGENT_ID).active);
    }

    function test_recordJobFee_writesAndFreezes() public {
        // Set up: agent registered, job exists in mock ACP with this owner as client
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        uint256 jobId = 7;
        IACP.Job memory j = IACP.Job({
            client: owner,
            provider: address(0),
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(jobId, j);

        // owner needs to also be a registered agent operator for recordJobFee
        // since the contract checks agentIdByOperator[msg.sender] for the cap.
        // Per spec: the *client* records the fee, so the client wallet must be
        // a registered operator. In this test setup, owner is both identity
        // owner of AGENT_ID and a registered operator wallet.
        // We register owner as an operator on a separate agent id to satisfy the cap lookup.
        idReg.setOwner(99, owner);
        vm.prank(owner);
        registry.registerAgent(99, owner, policy, 1_000_000, 100_000);

        vm.prank(owner);
        registry.recordJobFee(jobId, 50_000);

        assertEq(registry.evaluatorFeeFor(jobId), 50_000);
        assertTrue(registry.jobFeeRecorded(jobId));
    }

    function test_recordJobFee_revertsIfNotClient() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        uint256 jobId = 7;
        IACP.Job memory j = IACP.Job({
            client: owner,
            provider: address(0),
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(jobId, j);

        vm.expectRevert(bytes("not job client"));
        registry.recordJobFee(jobId, 50_000);
    }

    function test_recordJobFee_revertsIfAlreadyRecorded() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        uint256 jobId = 7;
        IACP.Job memory j = IACP.Job({
            client: owner,
            provider: address(0),
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(jobId, j);

        idReg.setOwner(99, owner);
        vm.prank(owner);
        registry.registerAgent(99, owner, policy, 1_000_000, 100_000);

        vm.prank(owner);
        registry.recordJobFee(jobId, 50_000);

        vm.expectRevert(bytes("fee already recorded"));
        vm.prank(owner);
        registry.recordJobFee(jobId, 30_000);
    }

    function test_recordJobFee_revertsIfFeeExceedsMax() public {
        bytes32 policy = keccak256("policy-v1");
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, policy, 1_000_000, 100_000);

        uint256 jobId = 7;
        IACP.Job memory j = IACP.Job({
            client: owner,
            provider: address(0),
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(jobId, j);

        idReg.setOwner(99, owner);
        vm.prank(owner);
        registry.registerAgent(99, owner, policy, 1_000_000, 100_000);

        vm.expectRevert(bytes("fee exceeds max"));
        vm.prank(owner);
        registry.recordJobFee(jobId, 200_000); // > 100_000 max
    }

    // ---- additional coverage: edge cases + uncovered functions ----

    function test_registerAgent_revertsOnZeroOperator() public {
        vm.expectRevert(bytes("operator zero"));
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, address(0), keccak256("p"), 1, 1);
    }

    function test_registerAgent_revertsIfAlreadyRegistered() public {
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p"), 1, 1);

        vm.expectRevert(bytes("already registered"));
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, address(0xDEAD), keccak256("p2"), 2, 2);
    }

    function test_updateOperator_revertsOnZeroOperator() public {
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p"), 1, 1);

        vm.expectRevert(bytes("operator zero"));
        vm.prank(owner);
        registry.updateOperator(AGENT_ID, address(0));
    }

    function test_updateOperator_revertsIfNotRegistered() public {
        // AGENT_ID has owner but never registered; updating should fail.
        vm.expectRevert(bytes("not registered"));
        vm.prank(owner);
        registry.updateOperator(AGENT_ID, address(0xCCCC));
    }

    function test_updatePolicy_updatesAllFields() public {
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p1"), 1_000_000, 100_000);

        bytes32 newPolicy = keccak256("p2");
        vm.prank(owner);
        registry.updatePolicy(AGENT_ID, newPolicy, 5_000_000, 250_000);

        IAgentRegistry.AgentInfo memory info = registry.agents(AGENT_ID);
        assertEq(info.currentPolicyHash, newPolicy);
        assertEq(info.perTxCap, 5_000_000);
        assertEq(info.evaluatorFeeMax, 250_000);
    }

    function test_updatePolicy_revertsIfNotRegistered() public {
        vm.expectRevert(bytes("not registered"));
        vm.prank(owner);
        registry.updatePolicy(AGENT_ID, keccak256("p"), 1, 1);
    }

    function test_reactivate_setsActiveTrue() public {
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p"), 1, 1);

        vm.prank(owner);
        registry.deactivate(AGENT_ID);
        assertFalse(registry.agents(AGENT_ID).active);

        vm.prank(owner);
        registry.reactivate(AGENT_ID);
        assertTrue(registry.agents(AGENT_ID).active);
    }

    function test_reactivate_revertsIfNotRegistered() public {
        vm.expectRevert(bytes("not registered"));
        vm.prank(owner);
        registry.reactivate(AGENT_ID);
    }

    function test_recordJobFee_revertsIfClientNotRegistered() public {
        // Job's client is a wallet that never registered as an operator.
        address strangerClient = address(0x9999);
        idReg.setOwner(AGENT_ID, owner); // already true from setUp
        // owner registers AGENT_ID with `operator` (NOT with strangerClient)
        vm.prank(owner);
        registry.registerAgent(AGENT_ID, operator, keccak256("p"), 1_000_000, 100_000);

        uint256 jobId = 7;
        IACP.Job memory j = IACP.Job({
            client: strangerClient,
            provider: address(0),
            evaluator: address(0),
            budget: 0,
            expiredAt: 0,
            status: IACP.JobStatus.Funded,
            reason: bytes32(0),
            hook: address(0)
        });
        acp.setJob(jobId, j);

        // strangerClient passes the j.client == msg.sender check but has
        // no registered agent, so the cap lookup fails.
        vm.expectRevert(bytes("client not registered"));
        vm.prank(strangerClient);
        registry.recordJobFee(jobId, 1);
    }
}
