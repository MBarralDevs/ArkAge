// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title  IIdentityRegistry — ERC-8004 agent identity surface used by ArkAge.
/// @notice Plan A captured only the read functions our hook contracts need.
///         Plan E2 (Theme B, 2026-05-12) extends with the `register` write
///         and the canonical ERC-721 Transfer event so we can encode the
///         calldata + parse minted token ids client-side.
///
///         Canonical signature on Arc Testnet (`0x8004A818...4BD9e`):
///         `register(string metadataURI)` — mints a new agent identity NFT
///         to `msg.sender`. The token id is auto-assigned (sequential) and
///         is emitted in the standard ERC-721 Transfer event; the call
///         itself returns nothing.
interface IIdentityRegistry {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function register(string calldata metadataURI) external;

    function ownerOf(uint256 agentId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function getApproved(uint256 agentId) external view returns (address);
}
