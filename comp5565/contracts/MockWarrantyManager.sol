// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./I_Interfaces.sol";

// MockWarrantyManager 合约：用于在测试中模拟保修管理器的行为。
contract MockWarrantyManager is IWarrantyManager {
    // 用于测试的内部状态，可以控制保修是否有效。
    bool public warrantyIsValid;

    constructor(bool initialStatus) {
        warrantyIsValid = initialStatus;
    }

    // 辅助测试函数：允许测试脚本切换保修的有效状态。
    function setValidStatus(bool status) public {
        warrantyIsValid = status;
    }

    // --- IWarrantyManager 接口的模拟实现 ---
    
    // 模拟：issueWarranty，部署流程会调用，但我们在此不实现实际逻辑。
    function issueWarranty(uint256 tokenId, uint256 durationDays, uint8 maxClaims) external override {
        // 模拟成功
    }

    // 模拟：isWarrantyValid，返回测试脚本设置的状态。
    function isWarrantyValid(uint256 productId) public view override returns (bool) {
        return warrantyIsValid;
    }
    
    // 模拟：requestService，客户申请服务。
    function requestService(uint256 tokenId) external override {
        // 模拟成功
    }
    
    // 模拟：approveClaim，服务中心批准。
    function approveClaim(uint256 tokenId, string memory log) external override {
        // 模拟成功
    }

    // 模拟：rejectClaim，服务中心拒绝。
    function rejectClaim(uint256 tokenId, string memory reason) external override {
        // 模拟成功
    }
    
    // 模拟：setProductRegistryAddress
    function setProductRegistryAddress(address _registryAddr) external override {
        // 模拟成功
    }
    
    // 模拟：setMarketplaceAddress
    function setMarketplaceAddress(address _mpAddr) external override {
        // 模拟成功
    }
    
    // 模拟：getWarrantyStatus，返回默认值。
    function getWarrantyStatus(uint256 tokenId) external view override returns (
        uint256, uint256, uint8, uint8, uint8, string memory
    ) {
        return (0, 0, 0, 0, 0, ""); // 返回 0 和空字符串作为默认值
    }
}