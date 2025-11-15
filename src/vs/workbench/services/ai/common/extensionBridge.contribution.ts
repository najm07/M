/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IExtensionBridgeService } from '../../../../services/ai/common/extensionBridge.js';
import { ExtensionBridgeService } from '../../../../services/ai/node/extensionBridgeServiceImpl.js';

registerSingleton(IExtensionBridgeService, ExtensionBridgeService, InstantiationType.Delayed);

