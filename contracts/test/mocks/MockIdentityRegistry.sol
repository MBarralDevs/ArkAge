// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 => address) private _owners;

    function setOwner(uint256 agentId, address owner) external {
        _owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return _owners[agentId];
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }
}
