// File: contracts/MockProductRegistry.sol (UPDATED)
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockProductRegistry {
    // 使用 mapping 来存储多个代币的所有者，以支持多次 issueNewProductAndWarranty
    mapping(uint256 => address) public tokenOwners; 
    
    constructor(address _owner, uint256 _tokenId) {
        tokenOwners[_tokenId] = _owner;
    }
    
    // 允许测试脚本设置某个代币的所有者
    function setTokenOwner(uint256 _tokenId, address _owner) public {
        tokenOwners[_tokenId] = _owner;
    }

    function ownerOf(uint256 _tokenId) public view returns (address) {
        return tokenOwners[_tokenId];
    }
}