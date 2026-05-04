// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IReputationRegistry} from "../../src/interfaces/IReputationRegistry.sol";

contract MockReputationRegistry is IReputationRegistry {
    struct Call {
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
        address sender;
    }

    Call[] public calls;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        calls.push(Call({
            agentId: agentId,
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            endpoint: endpoint,
            feedbackURI: feedbackURI,
            feedbackHash: feedbackHash,
            sender: msg.sender
        }));
    }

    function callsLength() external view returns (uint256) {
        return calls.length;
    }
}
