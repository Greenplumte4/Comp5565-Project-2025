// File: I_Interfaces.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 角色管理接口
interface IRolesContract {
    function isManufacturer(address _account) external view returns (bool);
    function isRetailer(address _account) external view returns (bool);
    function isServiceCenter(address _account) external view returns (bool);
    function hasAnyRole(address account) external view returns (bool);
}

// 产品注册接口 (NFT)
interface IProductRegistry {
    // 铸造并上架
    function mintProduct(
        address to, 
        string memory serialNumber, 
        string memory modelDetails, 
        string memory manufacturerDetails, 
        uint256 price, 
        string memory warrantyTermsURI
    ) external returns (uint256 tokenId);

    // 更新市场信息
    function updateMarketInfo(uint256 productId, uint256 price, bool isListed) external;
    
    // [新增] 获取市场价格信息
    function getProductMarketInfo(uint256 productId) external view returns (uint256 price, bool isListed);

    // 记录转移历史
    function recordOwnershipTransfer(uint256 productId, address from, address to, string memory eventType) external;
    
    // 标准查询
    function ownerOf(uint256 tokenId) external view returns (address);
    
    // 设置 Marketplace 地址
    function setMarketplaceAddress(address _marketplaceAddress) external;
    
    // [新增] 供 Marketplace 完成购买交易（强制转移）
    function executeMarketTransaction(address from, address to, uint256 tokenId) external;

    // [新增] 获取用户库存
    function getPlayerInventory(address _owner) external view returns (uint256[] memory);
}

// 保修管理接口
interface IWarrantyManager {
    function issueWarranty(uint256 tokenId, uint256 durationDays, uint8 maxClaims) external;
    function isWarrantyValid(uint256 productId) external view returns (bool);
    function requestService(uint256 tokenId) external;
    function approveClaim(uint256 tokenId, string memory log) external;
    function rejectClaim(uint256 tokenId, string memory reason) external;
    function setProductRegistryAddress(address _registryAddr) external;
    function setMarketplaceAddress(address _mpAddr) external;
    function getWarrantyStatus(uint256 tokenId) external view returns (uint256, uint256, uint8, uint8, uint8, string memory);
}