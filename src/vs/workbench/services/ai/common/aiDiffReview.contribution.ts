/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIDiffReviewService } from '../../../../services/ai/common/aiDiffReviewService.js';
import { AIDiffReviewService } from '../../../../services/ai/node/aiDiffReviewServiceImpl.js';

registerSingleton(IAIDiffReviewService, AIDiffReviewService, InstantiationType.Delayed);

