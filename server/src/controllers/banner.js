import sizeOf from 'image-size';
import config from 'config';
import request from 'request';
import filterCollection from '../../../frontend/src/lib/filter_collection';
import _ from 'lodash';
import Promise from 'bluebird';
import utils from '../lib/utils';
import queryString from 'query-string';
import url from 'url';

const requestPromise = Promise.promisify(request, {multiArgs: true});

const filterUsersByTier = (users, tiername) => {
  return _.uniq(filterCollection(users, { tier: tiername }), 'id');
};

export default {

  index: (req, res) => {
    res.render('backers', {
      users: req.users
    });
  },

  markdown: (req, res) => {
    const { slug } = req.params;
    const positions = [];
    const spots = req.params.spots || 30;
    const tiername = req.params.tier || '';

    for (let i=0; i<spots; i++) {
      positions[i] = { position: i };
    }

    let { tiers } = req.group;
    tiers.map(t => {
      t.positions = positions;
    });
    if (tiername) {
      tiers = tiers.filter(t => t.title.toLowerCase() == tiername );
    }

    res.render('bannermd', {
      layout: false,
      base_url: config.host.website,
      tiers,
      slug,
      positions
    })
  },

  js: (req, res) => {
    const { slug } = req.params;
    res.type('application/javascript');
    res.render('bannerjs', {
      layout: false,
      config,
      header: (req.query.header !== 'false'),
      slug
    })
  },

  avatar: (req, res) => {
    const tier = req.params.tier || '';
    const tierSingular = tier.replace(/s$/,'');
    const users = filterUsersByTier(req.users, tierSingular);
    const position = parseInt(req.params.position, 10);
    const user = (position < users.length) ?  users[position] : {};
    const format = req.params.format || 'svg';

    let maxHeight;

    if (req.query.avatarHeight) {
      maxHeight = Number(req.query.avatarHeight);
    } else {
      maxHeight = (format === 'svg' ) ? 128 : 64;
      if (tier.match(/silver/)) maxHeight *= 1.25;
      if (tier.match(/gold/)) maxHeight *= 1.5;
      if (tier.match(/diamond/)) maxHeight *= 2;
    }

    // We only record a page view when loading the first avatar
    if (position==0) {
      req.ga.pageview();
    }

    let imageUrl = "/static/images/user.svg";
    if (user.avatar && user.avatar.substr(0,1) !== '/') {
      if (!tier.match(/sponsor/)) {
        imageUrl = utils.getCloudinaryUrl(user.avatar, { query: `/c_thumb,g_face,h_${maxHeight},r_max,w_${maxHeight},bo_3px_solid_white/c_thumb,h_${maxHeight},r_max,w_${maxHeight},bo_2px_solid_rgb:66C71A/e_trim/f_auto/` });
      } else {
        imageUrl = utils.getCloudinaryUrl(user.avatar, { height: maxHeight });
      }
    }

    if (position == users.length) {
      const btnImage = (tier.match(/sponsor/)) ? 'sponsor' : tierSingular;
      imageUrl = `/static/images/become_${btnImage}.svg`;
    } else if (position > users.length) {
      imageUrl = "/static/images/1px.png";
    }

    if (imageUrl.substr(0,1) === '/') {
      return res.redirect(imageUrl);
    }

    if (format === 'svg') {
      request({url: imageUrl, encoding: null}, (err, r, data) => {
        if (err) {
          return res.status(500).send(`Unable to fetch ${imageUrl}`);
        }
        const contentType = r.headers['content-type'];

        const imageHeight = Math.round(maxHeight / 2);
        let imageWidth = 64;
        if (tier.match(/sponsor/)) {
          const dimensions = sizeOf(data);
          imageWidth = Math.round(dimensions.width / dimensions.height * imageHeight);
        }

        const base64data = new Buffer(data).toString('base64');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${imageWidth}" height="${imageHeight}">
          <image width="${imageWidth}" height="${imageHeight}" xlink:href="data:${contentType};base64,${base64data}"/>
        </svg>`;
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('content-type','image/svg+xml;charset=utf-8');
        return res.send(svg);
      });
    } else {
      req
        .pipe(request(imageUrl))
        .on('response', (res) => {
          res.headers['Cache-Control'] = 'public, max-age=300';
        })
        .pipe(res);
    }

  },

  badge: (req, res) => {
    const { tier } = req.params;
    const color = req.query.color || 'brightgreen';
    const { style } = req.query;

    const validator = (user) => (user.tier && user.tier.match(new RegExp(tier.replace(/s$/,''), 'i')));
    const users = _.uniq(filterCollection(req.users, validator), 'id');

    const count = users.length;
    const filename = `${tier}-${count}-${color}.svg`;
    const imageUrl = `https://img.shields.io/badge/${filename}?style=${style}`;

    request(imageUrl, (err, response, body) => {
      if (err) {
        return res.status(500).send(`Unable to fetch ${imageUrl}`);
      }
      res.setHeader('content-type','image/svg+xml;charset=utf-8');
      res.send(body);
    });
  },

  banner: (req, res) => {
    const { slug } = req.params;
    const { tier } = req.params;
    const format = req.params.format || 'svg';
    const limit = Number(req.query.limit) || Infinity;
    const margin = req.query.margin ? Number(req.query.margin) : 5;
    const imageWidth = Number(req.query.width) || 0;
    const imageHeight = Number(req.query.height) || 0;
    const avatarHeight = Number(req.query.avatarHeight) || 64;
    let users = filterUsersByTier(req.users, tier.replace(/s$/,''));
    const count = Math.min(limit, users.length);
    const showBtn = (req.query.button === 'false') ? false : true;
    const { order } = req.query;

    if (order === 'recent') {
      users = users.sort((a,b) => {
        return (new Date(b.createdAt) - new Date(a.createdAt));
      });
    }

    const promises = [];
    for (let i = 0 ; i < count ; i++) {
      let avatar = users[i].avatar;
      if (avatar) {
        if (!tier.match(/sponsor/)) {
          avatar = utils.getCloudinaryUrl(avatar, { query: `/c_thumb,g_face,h_${avatarHeight*2},r_max,w_${avatarHeight*2},bo_3px_solid_white/c_thumb,h_${avatarHeight*2},r_max,w_${avatarHeight*2},bo_2px_solid_rgb:66C71A/e_trim/f_auto/` });
        }
        const options = {url: avatar, encoding: null};
        promises.push(requestPromise(options));
      }
    }

    if (showBtn) {
      const btnImage = (tier.match(/sponsor/)) ? 'sponsor' : tier.replace(/s$/,'');
      const btn = {
        url: `${config.host.website}/static/images/become_${btnImage}.svg`,
        encoding: null
      };

      promises.push(requestPromise(btn));
    }

    let posX = margin;
    let posY = margin;

    Promise.all(promises)
    .then(responses => {
      const images = [];
      for (let i=0;i<responses.length;i++) {
        const { headers } = responses[i][0];
        const rawData = responses[i][1];

        const contentType = headers['content-type'];
        const website = (users[i] && users[i].website) ? users[i].website : `${config.host.website}/${slug}`;
        const base64data = new Buffer(rawData).toString('base64');

        let avatarWidth = avatarHeight;
        try {
          // We make sure the image loaded properly
          const dimensions = sizeOf(rawData);
          avatarWidth = Math.round(dimensions.width / dimensions.height * avatarHeight);
        } catch (e) {
          // Otherwise, we skip it
          console.error(`Cannot get the dimensions of the avatar of ${users[i].name}`, users[i].avatar);
          continue;
        }

        if (imageWidth > 0 && posX + avatarWidth + margin > imageWidth) {
          posY += (avatarHeight + margin);
          posX = margin;
        }
        const image = `<image x="${posX}" y="${posY}" width="${avatarWidth}" height="${avatarHeight}" xlink:href="data:${contentType};base64,${base64data}"/>`;
        const imageLink = `<a xlink:href="${website.replace(/&/g,'&amp;')}" target="_blank">${image}</a>`;
        images.push(imageLink);
        posX += avatarWidth + margin;
      }

      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${imageWidth || posX}" height="${imageHeight || posY + avatarHeight + margin}">
        ${images.join('\n')}
      </svg>`;
    })
    .then(svg => {
      switch (format) {
        case 'svg':
          res.setHeader('content-type','image/svg+xml;charset=utf-8');
          return svg;

        case 'png':
          res.setHeader('content-type','image/png');
          return utils.svg2png(svg)
      }
    })
    .then(svg => {
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(svg);
    })
    .catch(e => {
      console.log("Error in generating banner: ", e);
    });
  },

  redirect: (req, res) => {
    const { tier } = req.params;
    const users = filterUsersByTier(req.users, tier.replace(/s$/,''));
    const { slug } = req.params;
    const position = parseInt(req.params.position, 10);

    if (position > users.length) {
      return res.sendStatus(404);
    }

    const user = users[position] || {};
    user.twitter = user.twitterHandle ? `https://twitter.com/${user.twitterHandle}` : null;

    let redirectUrl =  user.website || user.twitter || `${config.host.website}/${slug}`;
    if (position === users.length) {
      redirectUrl = `${config.host.website}/${slug}#support`;
    }

    const parsedUrl = url.parse(redirectUrl);
    const params = queryString.parse(parsedUrl.query);

    params.utm_source = params.utm_source || 'opencollective';
    params.utm_medium = params.utm_medium || 'github';
    params.utm_campaign = params.utm_campaign || slug;

    parsedUrl.search = `?${queryString.stringify(params)}`;
    redirectUrl = url.format(parsedUrl);

    req.ga.event(`GithubWidget-${tier}`, `Click`, user.name, position);

    res.redirect(redirectUrl);
  }
};
