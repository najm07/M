/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IContextService } from '../../../../services/ai/common/contextService.js';
import { ContextService } from '../../../../services/ai/node/contextServiceImpl.js';

registerSingleton(IContextService, ContextService, InstantiationType.Delayed);

