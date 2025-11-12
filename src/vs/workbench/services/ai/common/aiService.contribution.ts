/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIService } from '../../../../services/ai/common/aiService.js';
import { AIService } from '../../../../services/ai/node/aiServiceImpl.js';

registerSingleton(IAIService, AIService, InstantiationType.Delayed);


