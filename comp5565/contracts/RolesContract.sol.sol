// File: RolesContract.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./I_Interfaces.sol";

contract RolesContract is AccessControl, IRolesContract {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");
    bytes32 public constant SERVICECENTER_ROLE = keccak256("SERVICECENTER_ROLE");

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // 仅管理员可授予角色
    function grantRole(bytes32 role, address account) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(role, account);
    }
    
    function revokeRole(bytes32 role, address account) public virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
    }

    function isManufacturer(address _account) external view override returns (bool) {
        return hasRole(MANUFACTURER_ROLE, _account);
    }

    function isRetailer(address _account) external view override returns (bool) {
        return hasRole(RETAILER_ROLE, _account);
    }

    function isServiceCenter(address _account) external view override returns (bool) {
        return hasRole(SERVICECENTER_ROLE, _account);
    }
    
    function hasAnyRole(address account) external view override returns (bool) {
        return 
            hasRole(MANUFACTURER_ROLE, account) ||
            hasRole(RETAILER_ROLE, account) ||
            hasRole(SERVICECENTER_ROLE, account);
    }
}