// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry} from "../../src/interfaces/IIdentityRegistry.sol";

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 => address) private _owners;
    uint256 private _nextTokenId;

    function setOwner(uint256 agentId, address owner) external {
        _owners[agentId] = owner;
    }

    /// @notice Mirrors ERC-8004 IdentityRegistry.register: mints the next
    ///         sequential token id to `msg.sender`. Token id is recoverable
    ///         via the Transfer event log.
    function register(string calldata) external {
        uint256 tokenId = _nextTokenId++;
        _owners[tokenId] = msg.sender;
        emit Transfer(address(0), msg.sender, tokenId);
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
