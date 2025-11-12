/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAgentService } from '../../../../services/ai/common/agentService.js';
import { AgentService } from '../../../../services/ai/node/agentServiceImpl.js';

registerSingleton(IAgentService, AgentService, InstantiationType.Delayed);

